/**
 * Pipeline definition: stage metadata, prompt templates and the pure helpers that
 * chain one stage's output into the next. No I/O here — see ollama.ts / backend.ts.
 */
import { FOOD_SAFE_MATERIALS, LIMITS, MACHINES } from './standards'
import { validateDesign, type Design, type Scorecard } from './validate'
import type { Precedent, Registry } from './registry'

export type StageId = '1' | '1b' | '2' | '3' | '4' | '5' | '6' | '7' | '8'
export type StageKind = 'llm' | 'vlm' | 'embedding' | 'deterministic' | 'viewer' | 'ml'

export interface StageDef {
  id: StageId
  name: string
  kind: StageKind
  modelClass: string
  recommendedModel: string | null
  purpose: string
  why: string
  consumes: string
  produces: string
  checks: string[]
}

export const STAGES: StageDef[] = [
  { id: '1', name: 'Spec extraction', kind: 'llm', modelClass: 'Instruction LLM', recommendedModel: 'llama3.1:8b',
    purpose: 'Turns the customer’s free-text request into a structured spec and classifies the part type.',
    why: 'Structured extraction from prose is a core instruction-following task; 7–30B models do it reliably.',
    consumes: 'Customer email or request', produces: 'Spec JSON → Stage 2 query, Stage 3 context, viewer',
    checks: ['Every extracted number must appear verbatim in the email (null-discipline)', 'Part type must be a registered change part'] },
  { id: '1b', name: 'Drawing reading', kind: 'vlm', modelClass: 'Vision-language model', recommendedModel: 'qwen2.5vl:7b',
    purpose: 'Same extraction as Stage 1 when the input is a photo or scanned drawing.',
    why: 'Needs a model that accepts an image and text in one call.',
    consumes: 'Image upload', produces: 'Spec JSON (same schema as Stage 1)',
    checks: ['Same null-discipline as Stage 1, applied to an image'] },
  { id: '2', name: 'Retrieval', kind: 'embedding', modelClass: 'Embedding model', recommendedModel: 'nomic-embed-text',
    purpose: 'Finds similar past parts and re-ranks them by how they performed in service.',
    why: 'Vector similarity, not generation. Outcome weighting stops a similar-but-failed part becoming the design basis.',
    consumes: 'Spec summary from Stage 1', produces: 'Outcome-ranked precedents → Stage 3',
    checks: ['#1 result must be a precedent that ran clean, not the closest one that jammed'] },
  { id: '3', name: 'Design reasoning', kind: 'llm', modelClass: 'Reasoning LLM (14B+)', recommendedModel: 'deepseek-r1:14b',
    purpose: 'Tree of thought: proposes three candidate designs and recommends one.',
    why: 'The one stage where model scale genuinely pays.',
    consumes: 'Spec + ranked precedents (+ Stage 5 feedback when looping)', produces: 'Three branches → each gated by Stage 5 → chosen branch',
    checks: ['Rationale must cite real precedent IDs (grounding)', 'Every branch is re-checked by Stage 5 before selection'] },
  { id: '4', name: 'CAD generation', kind: 'llm', modelClass: 'Code LLM', recommendedModel: 'qwen2.5-coder:14b',
    purpose: 'Writes a CadQuery script for the chosen branch.',
    why: 'Code-specialised models follow CAD API conventions far more reliably.',
    consumes: 'Chosen branch parameters', produces: 'CadQuery script (reviewed, never executed — STEP comes from the validated builder)',
    checks: ['Static checks per part type (true helix, through-cuts, STEP export)'] },
  { id: '5', name: 'Validation gate', kind: 'deterministic', modelClass: 'No model — by design', recommendedModel: null,
    purpose: 'Accept/reject on exact arithmetic against machine ratings, container tolerances and food-contact standards.',
    why: 'A language model’s ±0.15 mm estimate is a jam at 380 CPM. Safety-critical maths stays deterministic.',
    consumes: 'Any design', produces: 'Scorecard → accept, or feedback to Stage 3 / Stage 1',
    checks: ['Strict inequality on clearance floors', 'Unknown materials fail closed'] },
  { id: '6', name: 'Review & hand-off', kind: 'viewer', modelClass: 'No model', recommendedModel: null,
    purpose: 'Packages the validated design for the customer and publishes a review link.',
    why: 'Two audiences: engineers see everything; customers see an allowlist.',
    consumes: 'Validated design', produces: 'Customer link (allowlisted payload)',
    checks: ['No cost, tolerance, score or ranking fields may cross'] },
  { id: '7', name: 'Refinement', kind: 'llm', modelClass: 'Instruction LLM', recommendedModel: 'llama3.1:8b',
    purpose: 'Applies a plain-English edit as a targeted delta, not a redesign.',
    why: 'Same model family as Stage 1 — one served model covers both.',
    consumes: 'Current design + edit instruction', produces: 'Delta + unchanged list → Stage 5 recheck',
    checks: ['Silent drift on an untouched parameter is an automatic reject'] },
  { id: '8', name: 'Outcome learning', kind: 'ml', modelClass: 'Gradient boosting (offline)', recommendedModel: null,
    purpose: 'Predicts jam rate from design margins and feeds back into Stage 2 outcome weights.',
    why: 'Tabular regression — gradient boosting beats language models here.',
    consumes: 'Design margins', produces: 'Predicted jam rate (trained offline in stage8_model_comparison.ipynb)',
    checks: ['Top drivers must match: effective clearance, speed utilisation, wear class'] },
]
export const stageById = (id: StageId) => STAGES.find(s => s.id === id)!

/* ---------------- prompt templates ---------------- */
export const DEFAULT_PROMPTS: Partial<Record<StageId, string>> = {
  '1': `You are a precise engineering spec extractor for packaging-machine CHANGE PARTS (the parts swapped on a container format changeover).
Step 1 - classify part_type as exactly one of: {{part_types}}, or "unknown".
Step 2 - extract ONLY values explicitly stated in the email into this exact JSON (every key present; anything not stated -> null):
{"part_type":string,
 "machine_id":string|null,"target_speed_cpm":number|null,"material_id":string|null,"bottle_diameter_mm":number|null,"bottle_height_mm":number|null,"ovality_mm":number|null,
 "pocket_count":number|null,"pcd_mm":number|null,"wheel_thickness_mm":number|null,"shape":string|null,
 "pitch_mm":number|null,"outer_diameter_mm":number|null,"root_diameter_mm":number|null,"length_mm":number|null,"starts":number|null,"flight_thickness_mm":number|null,"handedness":"RH"|"LH"|null,
 "rail_radius_mm":number|null,"arc_angle_deg":number|null,"rail_height_mm":number|null,"thickness_mm":number|null,"contact_height_mm":number|null,"mating_pcd_mm":number|null,
 "unresolved_questions":string[]}
CRITICAL RULES: never guess, infer or "propose" a number - if the customer asks you to choose a value, leave it null and add it to unresolved_questions. Fields that belong to other part types stay null. Copy material names as written (e.g. "UHMW-PE", "POM"). Output ONLY the JSON object.`,
  '3': `You are a mechanical design reasoning engine for packaging-machine change parts. Part type: {{part_type}} ({{part_label}}).
Work as a tree of thought: propose EXACTLY 3 candidate branches - "A" conservative, "B" balanced, "C" aggressive - then pick the optimized one.
Machine constraints for {{machine_id}}: {{machine_limits}}. Effective clearance after container ovality must be > {{min_clearance}} mm.
Output ONLY a JSON object {"branches":[...]} where each branch has: branch_id, {{branch_fields}}, rationale (must cite the precedent IDs given and their outcomes, and explain each numeric choice), risk_flags (array; flag anything close to a precedent that failed or a machine limit), recommended (true on exactly ONE branch - the optimized choice). Numbers only, in mm / degrees; no units in values. material_id must be exactly one of: {{materials}}. handedness must be "RH" or "LH".`,
  '4': `You are a CadQuery code generator for packaging-machine change parts. Part type: {{part_type}} ({{part_label}}). Given the parameter JSON, output ONLY a complete, runnable CadQuery Python script (no markdown fences, no explanation). {{cad_hint}} Finish by exporting the final solid with .val().exportStep("output.step").`,
  '7': `You are a targeted design-refinement engine. Given a current design JSON and a plain-English edit instruction, output ONLY a JSON object: {"delta":{...only fields that change, with their NEW values...},"unchanged":[...every other key from the input, verbatim...]}. Never modify a field the instruction did not ask about - list it in unchanged instead. Recompute any dependent values correctly.`,
}

export const STAGE1_FEEDBACK_ADDENDUM = `

IMPORTANT - a previous design from this email was rejected because the customer's stated requirements conflict with standards or machine limits:
{{feedback}}
Re-extract the spec faithfully (keep every value exactly as the customer stated it - do not "fix" them) and add one concrete question per conflict to unresolved_questions (for example "Approve UHMW-PE or POM instead of mild steel?").`

export function templateVars(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))]
}
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)
}
export function machineLimits(machineId: string): string {
  const m = MACHINES[machineId]
  if (!m) return 'machine not in catalog'
  return `rated max ${m.maxCpm} CPM` + (m.screwMaxRpm ? `, infeed screw drive max ${m.screwMaxRpm} rpm and ${m.screwTorqueNm} N·m` : '')
}
export function promptVars(stage: StageId, ctx: { reg: Registry; type: string; machineId: string }): Record<string, string> {
  const part = ctx.reg.parts[ctx.type]
  return {
    part_types: Object.keys(ctx.reg.parts).map(k => `"${k}"`).join(', '),
    part_type: ctx.type,
    part_label: part?.label ?? ctx.type,
    machine_id: ctx.machineId,
    machine_limits: machineLimits(ctx.machineId),
    min_clearance: String(LIMITS.minEffectiveClearanceMm),
    branch_fields: (part?.branchFields ?? []).join(', '),
    materials: FOOD_SAFE_MATERIALS.join(', '),
    cad_hint: part?.cadHint ?? '',
    stage: stage,
  }
}

/* ---------------- chaining helpers ---------------- */
export type Spec = Record<string, any> & { part_type?: string; unresolved_questions?: string[] }
const has = (v: unknown) => v !== null && v !== undefined && v !== ''

export function specSummary(spec: Spec | null, reg: Registry): string {
  if (!spec) return ''
  const parts: string[] = []
  const T = spec.part_type ? reg.parts[spec.part_type] : null
  if (T) parts.push(T.label.replace(/\s*\(.*\)/, '').toLowerCase())
  const f = (k: string, fmt: (v: any) => string) => { if (has(spec[k])) parts.push(fmt(spec[k])) }
  f('pocket_count', v => `${v} pockets`); f('pcd_mm', v => `PCD ${v}mm`)
  f('pitch_mm', v => `pitch ${v}mm`); f('outer_diameter_mm', v => `OD ${v}mm`); f('length_mm', v => `length ${v}mm`); f('starts', v => `${v}-start`)
  f('rail_radius_mm', v => `rail R ${v}mm`); f('arc_angle_deg', v => `${v}° arc`); f('mating_pcd_mm', v => `on PCD ${v}mm`)
  f('bottle_diameter_mm', v => `container ⌀${v}mm`); f('material_id', v => String(v)); f('machine_id', v => String(v)); f('target_speed_cpm', v => `${v} CPM`)
  return parts.join(', ')
}

export function stage3Context(spec: Spec | null, precedents: Precedent[] | null, reg: Registry, fallbackType: string): string {
  const type = spec?.part_type && reg.parts[spec.part_type] ? spec.part_type : fallbackType
  const summary = specSummary(spec, reg) || `${reg.parts[type]?.label ?? type}`
  const open = spec?.unresolved_questions?.length ? `\nCustomer left open (propose these): ${spec.unresolved_questions.join('; ')}` : ''
  const list = precedents?.length ? precedents.slice(0, 3) : reg.precedents.filter(p => p.part_type === type).slice(0, 3)
  const label = precedents?.length ? 'Top precedents (outcome-ranked by Stage 2):' : 'Precedent library (unranked — run Stage 2 to rank by service outcome):'
  return `Spec: ${summary}${open}\n\n${label}\n${list.map((p, i) => `${i + 1}. ${p.id} — ${p.text} (outcome: ${p.outcome})`).join('\n')}`
}

/** Every number the model returned should literally appear in the source text. */
export function groundingFlags(parsed: Record<string, unknown>, source: string): string[] {
  const flagged: string[] = []
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'number') continue
    const s = String(v).replace(/\.0+$/, '')
    if (!new RegExp(`(^|[^0-9.])${s.replace('.', '\\.')}([^0-9]|$)`).test(source)) flagged.push(`${k}=${v}`)
  }
  return flagged
}

export function extractBranches(text: string): Record<string, any>[] | null {
  let parsed: any
  try { parsed = JSON.parse(text) } catch { return null }
  const isObj = (b: any) => b && typeof b === 'object' && !Array.isArray(b)
  if (Array.isArray(parsed)) return parsed.filter(isObj)
  if (isObj(parsed)) {
    for (const k of ['branches', 'candidates', 'designs', 'options']) if (Array.isArray(parsed[k])) return parsed[k].filter(isObj)
    return [parsed]
  }
  return null
}

/** LLM output is untrusted: unknown materials are dropped (fall back to the spec), handedness normalised. */
export function sanitizeBranch(b: Record<string, any>): Record<string, any> {
  const o: Record<string, any> = { ...b }
  if (o.material_id !== undefined && !FOOD_SAFE_MATERIALS.includes(o.material_id) ) { o._material_dropped = o.material_id; delete o.material_id }
  if (o.handedness !== undefined) o.handedness = /^l/i.test(String(o.handedness)) ? 'LH' : 'RH'
  return o
}

export function mergedDesign(spec: Spec | null, branch: Record<string, any> | null, reg: Registry,
  fallback: { type: string; params: Record<string, any>; common: Record<string, any> }): Design {
  const type = (spec?.part_type && reg.parts[spec.part_type]) ? spec.part_type
    : (branch?.part_type && reg.parts[branch.part_type]) ? branch.part_type : fallback.type
  const T = reg.parts[type]
  const pick = (...vals: any[]) => vals.find(has)
  const d: Design = { part_type: type }
  for (const k of Object.keys(T?.defaults ?? {})) d[k] = pick(branch?.[k], spec?.[k], type === fallback.type ? fallback.params[k] : undefined, T.defaults[k])
  const C = fallback.common
  d.material_id = pick(branch?.material_id, spec?.material_id, C.material_id)
  d.machine_id = pick(spec?.machine_id, C.machine_id)
  d.target_speed_cpm = pick(spec?.target_speed_cpm, C.target_speed_cpm)
  d.bottle_diameter_mm = pick(branch?.bottle_diameter_mm, spec?.bottle_diameter_mm, T?.commonDefaults?.bottle_diameter_mm, C.bottle_diameter_mm)
  d.bottle_height_mm = pick(spec?.bottle_height_mm, C.bottle_height_mm)
  d.ovality_mm = pick(spec?.ovality_mm, C.ovality_mm)
  return d
}

export interface BranchEval { branch: Record<string, any>; design: Design; card: Scorecard }
/** Recommended branch wins only if it passes Stage 5; else the first that passes; else carried forward to refine. */
export function chooseBranch(spec: Spec | null, branches: Record<string, any>[], reg: Registry,
  fallback: { type: string; params: Record<string, any>; common: Record<string, any> }): { evaluated: BranchEval[]; pick: BranchEval } {
  const evaluated = branches.map(raw => {
    const branch = sanitizeBranch(raw)
    const design = mergedDesign(spec, branch, reg, fallback)
    return { branch, design, card: validateDesign(design, reg.parts[design.part_type]?.label) }
  })
  const rec = evaluated.find(e => e.branch.recommended === true)
  const pick = rec && rec.card.verdict === 'accept' ? rec : (evaluated.find(e => e.card.verdict === 'accept') ?? rec ?? evaluated[0])
  return { evaluated, pick }
}

export const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}
