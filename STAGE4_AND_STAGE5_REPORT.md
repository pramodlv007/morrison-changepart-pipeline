# Project Report: Starwheel CAD Generation & Safety Validation (Stages 4 & 5)

---

## Executive Summary (In Plain English)

In modern automated packaging lines (such as bottling and capping plants), **starwheels** are precision rotating wheels that receive bottles at high speeds (300–700+ bottles per minute) and guide them through filling and capping carousels without jamming or breaking.

This project implements and verifies an end-to-end automated engineering pipeline for custom starwheels. This report covers **Stage 4 (CAD Model Generation)** and **Stage 5 (Deterministic Safety Validation)**:

```
[Stage 3: Design Parameters]
            │
            ▼
┌───────────────────────────────────────────────┐
│ Stage 4: AI CAD Generation                    │
│ • Turns numbers into CadQuery 3D Python code  │
│ • Validates: Syntax → Subprocess → 3D Solid   │
│ • Catches "blind pocket" geometric traps      │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│ Stage 5: Deterministic Validation (NO AI)     │
│ • Safety-critical engineering calculations    │
│ • Backed by FDA 21 CFR, ISBT, Machinery specs │
│ • 100% automated regression test pass         │
└───────────────────────────────────────────────┘
```

---

## Part 1: Stage 4 — CAD Generation

### 1. What is Stage 4?
Stage 4 takes the geometric dimensions chosen in Stage 3 (diameter, pocket count, thickness, shaft bore) and uses AI code-generation models to write a complete Python script using **CadQuery** (an industrial 3D CAD scripting framework powered by the OpenCASCADE / OCCT geometry kernel). When executed, this script exports an industry-standard `output.step` 3D solid model file ready for CNC manufacturing.

### 2. What Was the Key Problem to Solve?
A language model might generate code that *looks* right and even produces a 3D part with the *exact same volume*, but the pockets might be cut **blind** (only partially deep) rather than through the entire disk. If manufactured, bottles would slam into the solid wall and cause catastrophic line jams.

### 3. What Was Achieved in Stage 4?
We built a **3-Layer Mechanical Validation Harness** that tests scripts strictly by arithmetic and 3D geometry:
1. **Layer 1 (Static Syntax Check):** Uses Python's Abstract Syntax Tree (`ast`) to confirm valid code, proper imports, and standard export calls.
2. **Layer 2 (Runtime Execution Check):** Runs the script inside an isolated sandbox subprocess with a strict timeout and checks that a non-empty `output.step` file was created.
3. **Layer 3 (3D Geometry Kernel Probing):** Re-imports the exported STEP file into the OpenCASCADE CAD kernel and performs two checks:
   * **Volume Check:** Confirms the part volume is within $\pm 3\%$ of the design target.
   * **Boolean-Intersection Openness Probes:** Fires virtual cylinder probes across the wheel thickness at the center bore and 144 angular points along the bolt circle to guarantee all 16 pockets are genuine through-holes and evenly spaced.

**Key Proven Result:**
The diagnostic baseline `local_shallow_cad` successfully hit $<0.7\%$ volume error, but our openness probes caught that $0$ out of $16$ pockets were cut through, properly rejecting it. The verification harness proved that volume checks alone are unsafe.

---

## Part 2: Stage 5 — Deterministic Safety Validation

### 1. What is Stage 5?
Stage 5 is the **safety-critical gate** before any part reaches a CNC machine. 

> **Core Architectural Rule:** **Stage 5 uses NO AI / Machine Learning model by design.**
> A language model estimates and hallucinates; engineering safety requires exact arithmetic. If an LLM makes a $0.15\text{ mm}$ calculation mistake, bottles will jam at $380\text{ CPM}$.

### 2. What Was Achieved in Stage 5?
We transitioned Stage 5 from theoretical formulas into an industrial-grade, fully verified validation engine:

1. **Authoritative Standards Registry (`validation_standards.json`):**
   * **Machine OEM Ratings:** Catalog of real cappers (Morrison `CAP-12`, `CAP-16`, `CAP-24`, Arol, Zalkin) with rated max speeds and pitch circle diameter ranges.
   * **Food-Contact Compliance:** Cites federal regulations for food-contact plastics:
     * `UHMW-PE` (FDA 21 CFR § 177.1520 & EU 10/2011 Annex I)
     * `POM / Delrin` (FDA 21 CFR § 177.2470)
     * `PTFE / Teflon` (FDA 21 CFR § 177.1550)
     * Rejects non-compliant materials (`mild steel`, `brass`, `unpainted aluminum`) and fails closed on unknown polymers.
   * **Tolerance & Clearance Floors:** Strict clearance floor ($c_{\text{eff}} > 0.20\text{ mm}$) based on ISBT (International Society of Beverage Technologists) and ASTM D2911 container ovality standards.

2. **Modular Deterministic Engine (`stage5_engine.py`):**
   * Computes web thickness: $w = PCD \cdot \sin(\pi / N) - 2r$.
   * Computes effective clearance: $c_{\text{eff}} = \text{clearance} - \frac{\text{ovality}}{2}$.
   * Computes machine speed utilization: $\text{Util} = \frac{\text{target speed}}{\text{machine max speed}}$.
   * Generates a complete scorecard citing specific regulations for any failure.
   * Builds real 3D solids using CadQuery to verify bounding box dimensions ($701.6 \times 701.6 \times 20.0\text{ mm}$).

3. **100% Automated Test Suite (`test_stage5_validation.py`):**
   * **Test 1 (Branch A - Published Accept):** Reproduces published numbers to $<0.01\text{ mm}$ ($w=55.36\text{ mm}$, $c_{\text{eff}}=0.50\text{ mm}$, $\text{util}=0.844$, verdict = `accept`).
   * **Test 2 (Branch C - Published Reject):** Replicates the historic `SW-10884` jam failure ($c_{\text{eff}}=0.05\text{ mm} \le 0.20\text{ mm}$, verdict = `reject` for pocket binding).
   * **Test 3–7 (Edge Cases):** Correctly rejects boundary conditions (clearance exactly on $0.20\text{ mm}$ floor, machine overspeed, mild steel, unknown polymers, and thin structural webs).
   * **Test 8–9 (Geometry Probing):** Confirms mathematical formulas match 2D Euclidean geometry to $<0.0001\text{ mm}$ and matches 3D CadQuery solid bounding boxes.

