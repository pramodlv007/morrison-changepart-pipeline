# Pipeline Stage Notebooks — What Each One Does, How to Validate

Reference notes for the 8 working notebooks (Stage 1, 1b, 2, 3, 4, 5, 6, 7, 8),
each testing/comparing candidate models for one stage of the starwheel CAD
pipeline from `model_types_by_stage.md`. Every notebook follows the same shape:
real input from the doc's worked example → candidate model adapters → a
validation function specific to that stage's real failure mode → a comparison
table/chart. This note is the map across all eight — what each stage is
actually for, and what "correct" means well enough to check it, not just eyeball it.

---

## Stage 1 — Specification extraction

**What it does:** parses a free-text customer email into a structured JSON
spec (machine, container dimensions, target speed).

**Model type:** instruction-tuned LLM, 7B–30B.

**Candidates verified:** `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`,
`google/gemma-4-26b-a4b-it` (all via OpenRouter).

**How to validate:**
- Schema complete, all required fields present.
- Every value actually stated in the email is extracted correctly.
- **The critical check:** fields never mentioned (`ovality_mm`, `shape`) must
  stay `null`. A model that guesses a plausible value here is the exact
  failure mode the source doc warns about — weight this as an automatic
  reject regardless of how good the rest of the extraction is.
- `unresolved_questions` actually names what's missing.

**Notebook:** `stage1_model_comparison.ipynb`

---

## Stage 1b — Reading drawings and photographs

**What it does:** same task as Stage 1, but the input is an image (photo or
scanned drawing) instead of text.

**Model type:** vision-language model (VLM).

**Candidates verified:** `qwen/qwen3-vl-32b-instruct`, `google/gemma-4-31b-it`.

**How to validate:** identical criteria to Stage 1 (schema, accuracy,
no-hallucination, flags the gap), applied to a synthetic labeled bottle
sketch built in-notebook with Pillow (no real supplier-drawing dataset was
available, so the sketch deliberately leaves ovality/shape unlabeled to test
the same null-discipline against an image instead of text).

**Notebook:** `stage1b_model_comparison.ipynb`

---

## Stage 2 — Retrieval

**What it does:** finds similar past parts from the precedent library and
ranks them, factoring in how each one actually performed in service.

**Model type:** embedding model (not a chat LLM) — runs locally, no API key.

**Candidates verified:** `BAAI/bge-m3`, `Qwen/Qwen3-Embedding-0.6B`,
`intfloat/multilingual-e5-large-instruct`.

**How to validate:**
- Raw similarity actually discriminates related parts from unrelated ones
  (different machine/pocket-count should score low).
- **The critical check:** after multiplying similarity by `outcome_weight`,
  the #1 ranked precedent must be the one that ran clean in service, not the
  textually-closest one that jammed. A retrieval pipeline that hands back a
  failed precedent as the design basis has failed, no matter how good the
  raw similarity looked.

**Notebook:** `stage2_model_comparison.ipynb`

---

## Stage 3 — Design reasoning

**What it does:** turns the spec + retrieved precedents into several
candidate parameter sets, each with a stated rationale.

**Model type:** larger reasoning-capable LLM — the one stage where model
scale genuinely pays.

**Candidates verified:** `z-ai/glm-5.2`, `deepseek/deepseek-v4-pro`,
`qwen/qwen3.6-27b`.

**How to validate:** this is the softest stage to grade mechanically (no
geometry kernel to check reasoning against), so the notebook uses proxies:
- Schema + constraint satisfaction (pocket count matches the machine, cited
  material is real).
- **Grounding check:** does the rationale text actually reference the
  precedent evidence it was given (part numbers, outcome keywords), or is it
  generic boilerplate that would look the same regardless of input?
- **Risk awareness:** if parameters land close to a precedent that failed,
  is that flagged in `risk_flags`, or does it go out silently?

**Notebook:** `stage3_model_comparison.ipynb`

---

## Stage 4 — CAD generation

**What it does:** turns the chosen parameter set into an executable CadQuery
Python script that builds the actual solid.

**Model type:** code-specialized LLM.

**Candidates verified:** `qwen/qwen3-coder-next` (OpenRouter), Text-to-CadQuery
(`ricemonster/qwen2.5-3B-SFT`, run locally via `transformers`). CAD-Coder was
researched and excluded — it turned out to be a vision-language model needing
an image input, not text/JSON, so it isn't a fair comparison without
first rendering the spec to an image.

**How to validate:**
- Static: valid Python, imports `cadquery`, calls the export.
- Runtime: actually executes without error (in a subprocess, with a timeout).
- Geometry: the exported solid's volume matches what the parameters imply
  (within 3%), and the bore/pockets are genuinely open, not just
  close-in-volume by coincidence — checked with real boolean-intersection
  probes against the re-imported BREP solid, not a volume proxy.

**Notebook:** `stage4_model_comparison.ipynb`. Unlike the other stages, this
one was built and executed on a machine with real outbound network access
(`pip install cadquery` and live calls to `openrouter.ai`/`huggingface.co`
both work here), so its geometry checks run against a genuine local
CadQuery/OCCT kernel rather than a pre-executed, network-restricted run —
see `stage4_executed.ipynb` for a real, verified example of the
"close-in-volume by coincidence" failure mode actually getting caught
(volume within 0.7% of the reference, 0 of 16 pockets genuinely open). It
still shows `qwen3_coder_next` and `text_to_cadquery` as skipped in that
executed copy, same as the other stages — no `OPENROUTER_API_KEY` was
preloaded, and the local Text-to-CadQuery checkpoint deliberately refuses to
run 3B-parameter inference on this machine's CPU-only `torch` (see the
notebook's Section 4 for why, and how to force it).

---

## Stage 5 — Validation

**What it does:** the deterministic accept/reject gate — computes web
thickness, effective clearance, speed utilization, food-contact compliance,
and produces the scorecard.

**Model type: none, by design.** This is the safety-critical arithmetic
stage; the source doc is explicit that a model doesn't belong here.

**How to validate:** since there's no model to compare, this notebook is a
**regression test suite** instead:
- Reproduces the doc's exact published accept example (branch A) and reject
  example (branch C) with real `assert`s, not just a print.
- Edge cases: exactly at the clearance floor, over-speed, non-food-safe
  material, unknown material (must fail closed, not pass by default).
- Cross-checks the web-thickness formula against a real CadQuery/OCCT solid
  — not just trusting the algebra.

**Notebook:** `stage5_validation_suite.ipynb`

---

## Stage 6 — Review

**What it does:** presents the validated candidate to two audiences — full
detail (parameters, rationale, cost, tolerances) for the engineer; a filtered
3D view for the customer with cost and internal tolerances hidden.

**Model type: none.** A web viewer (three.js) and application logic.

**How to validate:** the real testable thing here is **the access-control
split**, not a model:
- `customer_view()` is built as an explicit allowlist (not a blocklist) —
  safer failure direction if a new field gets added later.
- A real assertion walks the customer view's full structure and confirms
  zero leakage of cost index, internal tolerances, weighted score, or rank.

**Bonus:** the notebook also builds a genuine three.js 3D viewer
(`starwheel_viewer.html`, self-contained, open it in any browser) plus a
guaranteed-offline matplotlib static preview.

**Notebook:** `stage6_review_viewer.ipynb`

---

## Stage 7 — Refinement

**What it does:** applies a plain-English edit instruction ("open the
pockets up by 0.3mm") as a targeted delta to an existing design, not a
redesign from scratch.

**Model type:** the same instruction-tuned LLM family as Stage 1 (one served
model covers both stages).

**Candidates verified:** same as Stage 1 — `qwen/qwen3.6-27b`,
`openai/gpt-oss-20b`, `google/gemma-4-26b-a4b-it`.

**How to validate:**
- Schema + the delta touches exactly the parameter(s) that were asked for.
- Recomputed dependent values (radius, web thickness, OD) are arithmetically
  correct, checked against the real geometry formulas, not just plausible.
- **The critical check:** every parameter NOT touched must appear in
  `unchanged` and genuinely be unchanged. A model that silently drifts an
  untouched parameter is a worse failure than one that gets the requested
  edit slightly wrong — per the source doc's own framing.
- `revalidation.verdict` matches what the real Stage-5-style check would say.

**Notebook:** `stage7_model_comparison.ipynb`

---

## Stage 8 — Outcome learning

**What it does:** predicts jam rate from a completed design's margins
(clearance, speed utilization, material wear class, etc.), feeding back into
ranking future candidates.

**Model type:** classical ML — gradient boosting or a small regressor. Not a
language model.

**Candidates verified:** mean baseline, linear regression, random forest,
scikit-learn `GradientBoostingRegressor`, XGBoost, LightGBM — **all six
actually trained and run in this sandbox**, since classical ML needs no
network calls at inference time (this is the one stage that runs 100% for
real everywhere, not just locally-vs-skipped).

**How to validate:**
- Cross-validated MAE must beat the naive "always predict the mean" floor by
  a real margin.
- **Driver agreement:** does the model's feature-importance ranking actually
  surface `effective_clearance`, `speed_utilisation`, and
  `material_wear_class` as top drivers, matching the doc's stated
  "top drivers: effective_clearance (+), speed_utilisation (+), wear_class (−)"?
  A model can have low error and still be right for the wrong reasons —
  this check catches that.

**Notebook:** `stage8_model_comparison.ipynb`

---

## Running these for real

This sandbox has no outbound network access to OpenRouter or Hugging Face,
so every notebook above shows its real API-based adapters as `skipped` when
pre-executed here — that's expected, not broken. The local baseline adapters
in each one prove the validation harness itself is correct before you trust
it on a real model.

To get real results:

| Stage | Needs | Notes |
|---|---|---|
| 1, 1b, 3, 4, 7 | `OPENROUTER_API_KEY` (positive balance) | Each notebook prompts for it via `getpass` — never hardcode it into a cell (a key pasted directly into a notebook is a leaked credential the moment that file is saved or shared). |
| 2 | nothing — just internet access | Downloads open-weight embedding models from Hugging Face on first run, then runs locally on CPU. |
| 5, 6, 8 | nothing | Fully local, no external calls at all — run anywhere. |

Run each in Colab (or any environment with normal internet) and the exact
same cells that show `skipped` here will return real accept/reject verdicts.
