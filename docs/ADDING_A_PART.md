# Adding a new change part

The pipeline is generic over change-part types. Three ship in the box —
`starwheel`, `feed_screw`, `guide_rail` — and a fourth is added in four steps.

Two of the four are **data only** (no code), so you can get a new part through
Stages 1–4 and the customer page before writing any physics.

---

## The split: data vs code

| Concern | Lives in | Code needed? |
|---|---|---|
| Stage 1 extraction fields, Stage 3 branch fields, Stage 4 CadQuery strategy + static checks, sample customer emails, sliders, customer-facing dimension labels | `parts/registry.json` or `parts/<name>.part.json` | **No** |
| Precedent library used by Stage 2 retrieval (the RAG corpus) | same file, `precedents[]` | **No** |
| Standards, machine ratings, material limits, thresholds | `validation_standards.json` | **No** |
| Stage 5 physics (what makes this part *safe*) | `stage5_engine.py` + the mirror in `app/src/core/validate.ts` | Yes |
| 3D mesh, drag handles, 2D drawing | `app/src/cad/geometry.ts` and `app/src/cad/drawing.ts` (shared by Studio and Design Review) | Yes |

---

## Step 1 — describe the part (data)

Create `parts/gripper.part.json`. Overlay files are merged over
`parts/registry.json` by `serve.py` at request time, so the core registry stays
clean and a new part is one self-contained file.

```json
{
  "part_types": {
    "gripper": {
      "label": "Gripper Jaw",
      "summary_for_customer": "A sprung jaw that grips each container by its neck as it is carried through the machine.",
      "defaults": { "jaw_opening_mm": 28, "jaw_depth_mm": 40, "pivot_offset_mm": 62, "thickness_mm": 14 },
      "common_defaults": { "bottle_diameter_mm": 28 },
      "sliders": [
        { "k": "jaw_opening_mm", "l": "Opening (mm)", "min": 15, "max": 60, "step": 1 },
        { "k": "jaw_depth_mm",   "l": "Depth (mm)",   "min": 20, "max": 80, "step": 1 }
      ],
      "customer_dimensions": [
        { "k": "jaw_opening_mm", "l": "Neck opening", "u": "mm" },
        { "k": "jaw_depth_mm",   "l": "Jaw depth",    "u": "mm" }
      ],
      "branch_fields": ["jaw_opening_mm", "jaw_depth_mm", "pivot_offset_mm", "thickness_mm", "material_id"],
      "cad_hint": "Sketch the jaw profile on XY (two arcs of radius jaw_opening_mm/2 …) and extrude by thickness_mm.",
      "cad_checks": [
        { "pattern": "import\\s+cadquery", "flags": "i", "label": "imports cadquery" },
        { "pattern": "extrude\\(",         "flags": "",  "label": "extrudes the jaw" },
        { "pattern": "exportStep",         "flags": "i", "label": "exports a STEP file" }
      ],
      "sample_emails": {
        "gripper_neck": { "label": "Gripper jaw — neck handling", "text": "From: …" }
      }
    }
  },
  "precedents": [
    { "id": "GJ-40021", "part_type": "gripper",
      "text": "Gripper jaw, 28mm neck opening, 40mm deep, POM, CAP-16, ran clean at 380 CPM.",
      "outcome": "clean" },
    { "id": "GJ-40044", "part_type": "gripper",
      "text": "Gripper jaw, 26mm opening on a 28mm neck, POM, CAP-16; jaws marked the necks and dropped containers.",
      "outcome": "jammed" }
  ]
}
```

Restart `serve.py` and reload the Studio. You now get: Stage 1 classifying
into `gripper`, a Stage 5 part-type dropdown entry, viewer sliders, Stage 3
branch fields, Stage 4 generation with your strategy and static checks, Stage 2
retrieval over *your* precedents, and a Design Review page that names the part in
plain language.

**Precedents are the RAG corpus.** Stage 2 embeds the query and each precedent
of the matching part type, then multiplies cosine similarity by an outcome
weight (`clean` 1.0, `jammed` 0.3) so a textually-similar part that failed in
service cannot become the design basis. Include both good and bad outcomes —
the bad ones are what make the ranking meaningful.

## Step 2 — add standards (data)

Put thresholds, machine ratings and material limits in
`validation_standards.json` rather than in code, so citations stay with the
numbers:

```json
"gripper_thresholds": {
  "min_neck_grip_ratio": 0.30,
  "max_jaw_pressure_n": 25.0,
  "reference_source": "Gripper Design Standard GJ-DS-01"
}
```

## Step 3 — write the physics (code)

Until this exists the part flows through the pipeline but Stage 5 reports it as
**UNVALIDATED** and the customer cannot approve it. Add:

1. `validate_gripper(branch_id, params, ovality_mm)` in `stage5_engine.py`,
   following `validate_feed_screw` — return `{part_type, verdict, checks,
   computed, citations, reasons|weighted_score}` and cite the standard on every
   failure.
2. Register it in `validate_change_part`'s dispatch.
3. Mirror it in `app/src/core/validate.ts` as `gripper(d)` returning checks (with
   `plain`/`plainReason` customer wording), formulas and tiles; add it to
   `IMPLEMENTED_PARTS` in `registry.ts` and to the `validateDesign` dispatch.
   Add repair hints for each check id in `app/src/core/repair.ts`.
4. Tests in `test_stage5_validation.py`: one reference **accept** with numbers
   you can defend, and one **reject** per rule.

The browser and Python engines must agree — every Stage 5 run in the Studio
compares them and flags a mismatch.

## Step 4 — geometry (code)

1. `build_gripper_solid(params)` in `stage5_engine.py` using CadQuery — this is
   what `/api/step` exports, and it is **never** model-generated code.
2. A `gripper(d)` builder in `app/src/cad/geometry.ts` returning the group, hotspot
   anchors and extent, plus entries in `handlesFor()` for direct manipulation.
3. A branch in `drawingSvg()` in `app/src/cad/drawing.ts`.
4. Optionally a feature-tree entry in `FEATURES` (`app/src/studio/DesignPanel.tsx`).

> Verify new CadQuery strategies against the real kernel before trusting them.
> `twistExtrude` looks right for a helical screw flight but only rotates the end
> face — the working approach was sweeping a profile along `cq.Wire.makeHelix`.
> A `cad_hint` that encodes the wrong strategy will have every model repeat it.

---

## Checklist

- [ ] `parts/<name>.part.json` with defaults, sliders, branch fields, cad hint + checks, sample emails
- [ ] At least two precedents, including one `jammed`, so outcome-weighting is exercised
- [ ] Thresholds and citations in `validation_standards.json`
- [ ] `validate_<name>` in `stage5_engine.py` + dispatch entry
- [ ] Mirror validator in `app/src/core/validate.ts` + repair hints + `IMPLEMENTED_PARTS`
- [ ] `build_<name>_solid` in `stage5_engine.py`; builder + handles in `geometry.ts`; drawing branch
- [ ] Tests: one accept, one reject per rule; `python -m pytest test_stage5_validation.py`
- [ ] Browser and Python verdicts agree (Stage 5 run notes), `npm test` and `npm run e2e` pass
