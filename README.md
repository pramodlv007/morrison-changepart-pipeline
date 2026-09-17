# Morrison change-part pipeline

Generative-AI design pipeline for packaging-machine **change parts** — the parts
swapped when a line changes container format. It turns a customer's plain-English
email into candidate designs, gates them through deterministic physics and
standards checks, and produces a CAD-ready STEP file, a 3D view and a dimensioned
drawing.

Three parts ship today: **starwheel**, **feed screw (timing screw)**, **guide rail**.
Adding a fourth is mostly data — see [`docs/ADDING_A_PART.md`](docs/ADDING_A_PART.md).

LLM stages run against a **local Ollama** instance; nothing is sent to a cloud API.

---

## Run it

```bash
ollama serve                 # or launch the Ollama app
python serve.py              # backend + both pages
```

| | |
|---|---|
| Engineering dashboard | <http://localhost:8765/> |
| Customer page | <http://localhost:8765/customer> |

`pipeline_dashboard.html` also opens straight from disk — it falls back to an
embedded copy of the registry, but loses STEP export and the Python cross-check.

**Browser → Ollama needs CORS.** Set `OLLAMA_ORIGINS=*` (Windows:
`setx OLLAMA_ORIGINS "*"`) and restart Ollama, or the browser silently blocks
every model call.

Models: any pulled model works; the dashboard lists what you have. The stage
cards name the model each stage is designed for (`llama3.1:8b`,
`qwen2.5-coder:14b`, `nomic-embed-text`, …).

---

## The eight stages

| Stage | Does | Model |
|---|---|---|
| 1 | Reads the customer email → structured spec, classifies the part type | instruction LLM |
| 1b | Same from a drawing or photo | vision LLM |
| 2 | Finds similar past parts, re-ranked by how they performed in service | embeddings |
| 3 | Tree-of-thought: 3 candidate branches, each gated by Stage 5 | reasoning LLM |
| 4 | CadQuery script for the chosen branch | code LLM |
| 5 | **Deterministic accept/reject** — no model, by design | none |
| 6 | 3D view, dimensioned drawing, customer hand-off | none |
| 7 | Plain-English edits applied as a delta, with drift detection | instruction LLM |
| 8 | Predicts jam rate from service outcomes | gradient boosting |

### Stage 5 is the safety gate

A language model's ±0.15 mm estimate is a jam at 380 CPM. Every numeric check is
exact arithmetic in [`stage5_engine.py`](stage5_engine.py), cited against FDA
21 CFR, ISBT §4.3, ASTM D2911 and OEM machine ratings in
[`validation_standards.json`](validation_standards.json):

- effective clearance after container ovality (strict `> 0.20 mm`)
- starwheel web thickness; feed-screw drive torque and rpm vs the machine's rating;
  guide-rail radial load vs the material's allowable, wrap angle, contact height
- food-contact material compliance, failing **closed** on anything unregistered

The browser mirrors this engine so the UI stays live; the Stage 5 panel's
*cross-check with Python engine* button proves the two agree.

A part type present in the registry but with no physics yet reports
**UNVALIDATED** — it never borrows another part's validator or geometry.

### The feedback loop

When Stage 5 rejects, failures are routed by cause (up to 3 iterations):

- **geometry** (clearance, web, engagement, gap) → back to **Stage 3** with the
  failed checks, the rejected values and the hard limits, to redesign
- **spec-level** (non-compliant material, over the machine's rated speed) → back
  to **Stage 1**, which re-extracts and drafts the questions the customer must
  answer; these surface on the customer page

### CAD output

STEP files are built by CadQuery from the **validated parameters**
(`build_*_solid` in `stage5_engine.py`) — never by executing model-generated
code. Stage 4's generated script is checked statically and shown for review.

---

## Layout

```
pipeline_dashboard.html   engineering UI (8 stages, 3D + drawing, trace, Ollama calls)
customer.html             plain-language customer page (approve / request changes)
serve.py                  static server + /api/health /api/registry /api/validate /api/step
stage5_engine.py          deterministic validators + CadQuery solid builders
validation_standards.json machine ratings, materials, thresholds, citations
parts/registry.json       part-type registry: schemas, sliders, CAD hints, samples, precedents
parts/*.part.json         overlays — drop-in new part types, merged at request time
docs/ADDING_A_PART.md     how to add a part type
test_stage5_validation.py 23 regression tests incl. real OCCT solid checks
stage*_*.ipynb            per-stage model comparison notebooks
```

## The customer page

`/customer` is the two-audience split from Stage 6, made interactive. A dark
studio viewer with orbit, preset camera flights, exploded view, container
ghosts and hotspots that explain each feature where it physically is.

It is a configurator, not a read-only page: sliders and material swatches
rebuild the model live, and every change is re-checked by the **same Python
engine** the engineers use (`POST /api/validate`) — a safe change reports
"this will run on your line", an unsafe one says what would go wrong in plain
words. An **Advanced** panel exposes every parameter the engineering viewer
has (all geometry, machine, line speed, container size, ovality) for customers
who want them; the simple view stays the default. Changes travel back as
structured adjustments and land in the engineer's Stage 7.

What crosses to the customer is an explicit allowlist — cost, tolerances,
weighted scores and rankings never do.

## Tests

```bash
python -m pytest test_stage5_validation.py -q      # deterministic engine, 23 tests

python serve.py                                    # in another terminal
npm install puppeteer-core --no-save
node tests/ui_tests.js                             # browser regression, 45 checks
```

The Python suite covers the published starwheel accept/reject cases, every
feed-screw and guide-rail rule, the trig-vs-Euclidean cross-check, and real
CadQuery solids (helix volume, annular-sector volume vs analytic).

The browser suite drives real Chrome against both pages: validators and their
Python cross-check, per-part 3D/2D geometry, cross-stage chaining, feedback-loop
routing and the computed repair hints, the customer configurator (including the
advanced panel and the allowlist), and registry extensibility via a drop-in part
file it creates and removes itself. LLM stages are excluded — they need a warm
Ollama and minutes per call.
