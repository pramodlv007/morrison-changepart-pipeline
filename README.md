# Change-Part Studio

Generative-AI design pipeline for packaging-machine **change parts** — the parts
swapped when a line changes container format. It turns a customer's plain-English
request into candidate designs, gates them through deterministic physics and
standards checks, and produces a CAD-ready STEP file, an interactive 3D model and
a dimensioned drawing.

Two products share one engine:

| | Who | URL |
|---|---|---|
| **Studio** | Engineers. Every stage's inputs, outputs, prompts, model and run history — editable and re-runnable. | <http://localhost:8765/> |
| **Design Review** | Customers. Plain-language requirements, a 3D editor with live checks, approve or request changes. | <http://localhost:8765/customer?d=…> |

Three parts ship today: **starwheel**, **feed screw (timing screw)**, **guide rail**.
Adding a fourth is mostly data — see [`docs/ADDING_A_PART.md`](docs/ADDING_A_PART.md).

LLM stages run on a **local Ollama** instance through the backend proxy; nothing
is sent to a cloud API and the browser never needs `OLLAMA_ORIGINS`.

---

## Run it

```bash
ollama serve                       # or launch the Ollama app
cd app && npm install && npm run build && cd ..
python serve.py                    # serves app/dist + the API on :8765
```

For UI development, run `python serve.py` and `npm run dev` in `app/` — Vite
serves on :5173 and proxies `/api` to the backend.

Models: any pulled model works; each stage picks its recommended model if
installed (`llama3.1:8b`, `deepseek-r1:14b`, `qwen2.5-coder:14b`,
`nomic-embed-text`, …) and otherwise falls back to an installed one. The Model tab
shows the choice and the `ollama pull` command for anything missing.

The product name lives in one constant, `app/src/core/app.ts`.

---

## Studio (engineers)

- **Pipeline rail** — all nine stages grouped *Understand → Design → Deliver*, with live
  status, latency and the Stage 5 feedback-loop history.
- **Stage inspector** — per stage:
  *Overview* (purpose, consumes → produces, model rationale, guardrails),
  *Input* (exactly what the stage receives, with its source),
  *Prompt* (editable template, variable chips with their current values, the filled prompt),
  *Model* (installed-model picker, temperature, call settings),
  *Output* (live token stream, then a structured view — spec table with grounding flags,
  ranked precedents, the three branch cards, CadQuery script with static checks, the
  scorecard with formulas and computed corrections, publish panel, refinement delta), and
  *Runs* (history with system/input/output and a diff against the previous run).
- **Live design panel** — 3D viewer and drawing, geometry sliders whose tracks show in green
  the values that pass Stage 5, operating conditions, and the validation scorecard.
- **CAD workspace** — feature tree, full-size viewport, properties and validation.
- Viewer tools: ViewCube, animated Iso/Top/Front/Side, drag handles that resize the part,
  exploded view, container ghosts, dimension labels, section plane, two-point measure,
  compare with the Stage 1 baseline, PNG export, full screen.
- Command palette (**Ctrl K**), **Ctrl Enter** runs the selected stage, customer inbox,
  activity log.

Prompt edits, model choices, inputs, outputs and run history are kept in
**sessionStorage**: a refresh keeps them, closing the tab clears them.

## Design Review (customers)

A light, jargon-free four-step flow:

1. **Requirements** — what we understood, as editable cards (machine, line speed, container
   size, material swatches, rotation) plus any open questions to answer.
2. **Design** — the 3D model with pull handles and numbered hotspots, adjust sliders with
   green safe zones, material, *More dimensions*, undo/redo, and a violet outline of the
   original proposal.
3. **Checks** — every engineering check in plain words and the dimensioned drawing.
4. **Approve** — summary, the customer's changes, a message; approve (only when every check
   passes) or send changes. Responses land in the Studio inbox, where adjustments apply to
   the design in one click or go to Stage 7.

Without a link, `/customer` is a **configurator**: the customer picks a part, enters their
line (machine, speed, container size, material, rotation), shapes the part in the same 3D
editor with live checks, undo/redo and *More dimensions*, and sends the finished design.
It lands in the Studio inbox, where *Open their design* loads it straight into the design
panel. What
crosses to the customer is an explicit allowlist — cost, tolerances, scores and rankings
never do.

---

## The stages

| Stage | Does | Model |
|---|---|---|
| 1 | Customer request → structured spec, classifies the part type | instruction LLM |
| 1b | Same from a drawing or photo | vision LLM |
| 2 | Similar past parts, re-ranked by service outcome (jammed ×0.3) | embeddings |
| 3 | Tree of thought: 3 branches, each gated by Stage 5 | reasoning LLM |
| 4 | CadQuery script for the chosen branch (reviewed, never executed) | code LLM |
| 5 | **Deterministic accept/reject** — no model, by design | none |
| 6 | Publishes the allowlisted design as a customer link | none |
| 7 | Plain-English edit applied as a delta, with drift detection | instruction LLM |
| 8 | Jam-rate model, trained offline in the notebook | gradient boosting |

### Stage 5 is the safety gate

A language model's ±0.15 mm estimate is a jam at 380 CPM. Every numeric check is
exact arithmetic in [`stage5_engine.py`](stage5_engine.py), cited against FDA
21 CFR, ISBT §4.3, ASTM D2911 and OEM machine ratings in
[`validation_standards.json`](validation_standards.json). The browser mirror
(`app/src/core/validate.ts`) reads the same JSON, and every Stage 5 run is
cross-checked against the Python engine. A registered part without physics
reports **UNVALIDATED**; it never borrows another part's validator.

### The feedback loop

When Stage 5 rejects, failures are routed by cause (configurable, default 3 attempts):

- **geometry** → back to **Stage 3** with the failed checks, the rejected values and
  exact computed corrections (e.g. "pocket_clearance_mm must be MORE than 0.5")
- **spec conflict** (non-compliant material, over the machine's rated speed) → back to
  **Stage 1**, which drafts the questions the customer must answer, then stops for a
  customer decision

### CAD output

STEP files are built by CadQuery from the **validated parameters**
(`build_*_solid` in `stage5_engine.py`) — never by executing model-generated code.

---

## Layout

```
app/                      the UI (Vite + React + TypeScript + Tailwind + three.js)
  src/core/               engine: standards, registry, Stage 5 mirror, feedback loop,
                          pipeline chaining, Ollama client, backend client
  src/cad/                parametric geometry, 3D viewer, 2D drawing
  src/studio/             engineer Studio
  src/customer/           customer Design Review
  src/ui/                 shared components (both themes)
  tests/e2e.mjs           browser suite
serve.py                  serves app/dist + /api (registry, validate, STEP, Ollama proxy, hand-off store)
stage5_engine.py          deterministic validators + CadQuery solid builders
validation_standards.json machine ratings, materials, thresholds, citations
parts/registry.json       part types: schemas, sliders, CAD hints, samples, precedents
parts/*.part.json         drop-in part-type overlays
data/store.json           published designs, customer responses and requests (git-ignored)
stage*_*.ipynb            per-stage model comparison notebooks
```

## Tests

```bash
python -m pytest test_stage5_validation.py -q    # Python engine, 23 tests
cd app
npm test                                         # engine mirror + chaining, 21 tests
npm run e2e                                      # browser suite against :8765, 63 checks
E2E_LLM=1 npm run e2e                            # + a real Stage 1 call on local Ollama
```

The browser suite drives real Chrome against both products: live verdicts and the
Python cross-check, part switching, prompt edits surviving a reload, viewer tools,
the command palette and CAD workspace, the publish allowlist, the full customer
flow including undo and the response reaching the backend, phone-width layout, the
configurator (part switching, live checks, refresh-safe state, the design reaching the
inbox) and loading a customer design into the Studio. It backs up and restores `data/store.json`.
