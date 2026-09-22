/**
 * Stage execution. Each run records exactly what was sent (system + user) and what came
 * back, so the inspector can show an engineer the real inputs and outputs of every stage.
 */
import {
  DEFAULT_PROMPTS, STAGE1_FEEDBACK_ADDENDUM, chooseBranch, cosine, extractBranches, fillTemplate, groundingFlags,
  mergedDesign, promptVars, specSummary, stage3Context, stageById, type StageId, type Spec,
} from '@/core/pipeline'
import { chat, describeError, embed, listModels } from '@/core/ollama'
import { validateDesign, type Design } from '@/core/validate'
import { classifyFailure, feedbackPacket, repairHints } from '@/core/repair'
import { health, loadRegistry, publishDesign, validateRemote, type CustomerPayload } from '@/core/backend'
import { designOf, useRuntime, useStudio, COMMON_KEYS, type Run } from './store'
import { toast } from '@/ui/overlay'

const S = () => useStudio.getState()
const R = () => useRuntime.getState()
let controller: AbortController | null = null
const uid = () => Math.random().toString(36).slice(2, 10)

/* ---------------- environment ---------------- */
export async function refreshEnvironment() {
  const [h, models, reg] = await Promise.all([health(), listModels(), loadRegistry()])
  R().set({
    health: { backend: !!h, ollama: !!h?.ollama || models.length > 0, cadquery: !!h?.cadquery, checked: true },
    installed: models,
    ...(reg ? { registry: reg } : {}),
  })
}

/** Stage override → recommended (if installed) → a sensible installed fallback. */
export function resolveModel(id: StageId): string {
  const o = S().models[id]
  if (o) return o
  const installed = R().installed
  const rec = stageById(id).recommendedModel
  const match = (m: string) => installed.find(x => x === m || x.split(':')[0] === m.split(':')[0])
  if (rec && match(rec)) return match(rec)!
  if (id === '2') return match('nomic-embed-text') ?? match('mxbai-embed-large') ?? pickLLM(installed) ?? 'nomic-embed-text'
  if (id === '1b') return match('qwen2.5vl') ?? match('llava') ?? match('llama3.2-vision') ?? rec ?? 'qwen2.5vl:7b'
  return pickLLM(installed) ?? rec ?? 'llama3.2'
}
const pickLLM = (installed: string[]) =>
  ['llama3.2', 'llama3.1', 'llama3', 'qwen2.5', 'mistral'].map(p => installed.find(x => x.split(':')[0] === p)).find(Boolean) ?? installed[0]

export function systemPrompt(id: StageId): { template: string; filled: string } {
  const s = S(), template = s.prompts[id] ?? DEFAULT_PROMPTS[id === '1b' ? '1' : id] ?? ''
  let filled = fillTemplate(template, promptVars(id, { reg: R().registry, type: s.partType, machineId: String(s.common.machine_id) }))
  if ((id === '1' || id === '1b') && s.feedback.stage1) filled += fillTemplate(STAGE1_FEEDBACK_ADDENDUM, { feedback: s.feedback.stage1 })
  return { template, filled }
}

export function userInput(id: StageId): string {
  const s = S()
  switch (id) {
    case '1': return s.email
    case '1b': return 'Extract the spec from this drawing or photo.'
    case '2': return specSummary(s.spec, R().registry) || R().registry.parts[s.partType]?.label || s.partType
    case '3': return stage3Context(s.spec, s.ranked, R().registry, s.partType) + (s.feedback.stage3 ? `\n\n${s.feedback.stage3}` : '')
    case '4': return JSON.stringify(designOf(s), null, 2)
    case '7': return JSON.stringify({ current_design: designOf(s), instruction: s.refine?.instruction ?? '' }, null, 2)
    default: return JSON.stringify(designOf(s), null, 2)
  }
}

const fallback = () => { const s = S(); return { type: s.partType, params: s.params, common: s.common } }
const parseJSON = (t: string): any => {
  try { return JSON.parse(t) } catch { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/)
  if (m) try { return JSON.parse(m[0]) } catch { /* ignore */ }
  return null
}

/* ---------------- single stage ---------------- */
type Outcome = 'ok' | 'fail' | 'stop'
async function llm(id: StageId, opts: { json?: boolean; images?: string[]; iteration?: number }): Promise<{ run: Run; text: string } | null> {
  const s = S(), model = resolveModel(id), { filled } = systemPrompt(id), user = userInput(id)
  const run: Run = { id: uid(), stage: id, ts: Date.now(), ok: false, model, system: filled, user, iteration: opts.iteration }
  s.setStatus(id, 'running'); R().set({ runningStage: id }); R().stream(id, '')
  s.log(id, 'info', `Calling ${model}${opts.iteration ? ` (loop iteration ${opts.iteration})` : ''}`)
  try {
    const res = await chat({ model, system: filled, user, images: opts.images, json: opts.json, temperature: s.temps[id] ?? (id === '3' ? 0.4 : 0.1),
      signal: controller?.signal, onToken: t => R().stream(id, t) })
    run.output = res.text; run.meta = res.meta; run.ok = true
    return { run, text: res.text }
  } catch (e) {
    run.error = describeError(e, model)
    run.output = R().streams[id] ?? ''
    s.addRun(run); s.setStatus(id, 'error')
    s.log(id, 'error', `${run.error.title}: ${run.error.detail}`)
    if ((e as any)?.name !== 'AbortError') toast.error(`Stage ${id} · ${run.error.title}`, run.error.hint || run.error.detail)
    return null
  }
}

export async function runStage(id: StageId, opts: { iteration?: number; image?: string } = {}): Promise<Outcome> {
  const s = S()
  if (!controller) controller = new AbortController()
  try {
    switch (id) {
      case '1': case '1b': {
        if (id === '1' && !s.email.trim()) { toast.warning('Add a customer request first', 'Paste an email into the Input tab of Stage 1.'); return 'fail' }
        if (id === '1b' && !opts.image) { toast.warning('Upload a drawing or photo first'); return 'fail' }
        const r = await llm(id, { json: true, images: opts.image ? [opts.image] : undefined, iteration: opts.iteration })
        if (!r) return 'fail'
        const spec = parseJSON(r.text) as Spec | null
        if (!spec) return finishFail(r.run, 'The model did not return valid JSON.')
        const reg = R().registry
        const notes: string[] = []
        if (spec.part_type && !reg.parts[spec.part_type]) notes.push(`part_type "${spec.part_type}" is not registered — kept ${s.partType}`)
        const flags = id === '1' ? groundingFlags(Object.fromEntries(Object.entries(spec).filter(([k]) => k !== 'unresolved_questions')), s.email) : []
        if (flags.length) notes.push(`Not found verbatim in the email: ${flags.join(', ')}`)
        const type = spec.part_type && reg.parts[spec.part_type] ? spec.part_type : s.partType
        if (type !== s.partType) S().setPartType(type, reg)
        const design = mergedDesign(spec, null, reg, fallback())
        S().loadDesign(design)
        S().set({ spec, grounding: flags, baseline: design })
        r.run.notes = notes
        return finishOk(r.run, `Spec extracted · ${reg.parts[type]?.label ?? type}${spec.unresolved_questions?.length ? ` · ${spec.unresolved_questions.length} open question(s)` : ''}`)
      }
      case '2': {
        const model = resolveModel('2'), query = userInput('2')
        const run: Run = { id: uid(), stage: '2', ts: Date.now(), ok: false, model, user: query }
        s.setStatus('2', 'running'); R().set({ runningStage: '2' })
        const pool = R().registry.precedents.filter(p => p.part_type === S().partType)
        if (!pool.length) return finishFail(run, 'No precedents registered for this part type.')
        try {
          const t0 = performance.now()
          const q = await embed(model, query, controller.signal)
          const ranked = []
          for (const p of pool) {
            const v = await cachedEmbed(model, p.text)
            const sim = cosine(q, v)
            ranked.push({ id: p.id, part_type: p.part_type, text: p.text, outcome: p.outcome, sim, score: sim * (p.outcome === 'clean' ? 1 : 0.3) })
          }
          ranked.sort((a, b) => b.score - a.score)
          S().set({ ranked })
          run.output = JSON.stringify(ranked.map(r => ({ id: r.id, outcome: r.outcome, similarity: +r.sim.toFixed(4), weighted: +r.score.toFixed(4) })), null, 2)
          run.meta = { ms: Math.round(performance.now() - t0), promptTokens: 0, evalTokens: 0, tokPerSec: null, loadMs: 0 }
          run.ok = true
          if (ranked[0]?.outcome !== 'clean') run.notes = ['Top result is not a clean-running precedent — review before relying on it.']
          return finishOk(run, `Ranked ${ranked.length} precedents · top ${ranked[0].id}`)
        } catch (e) {
          run.error = describeError(e, model)
          S().addRun(run); S().setStatus('2', 'error'); S().log('2', 'error', run.error.detail)
          if ((e as any)?.name !== 'AbortError') toast.error('Stage 2 · ' + run.error.title, run.error.hint || run.error.detail)
          return 'fail'
        }
      }
      case '3': {
        const r = await llm('3', { json: true, iteration: opts.iteration })
        if (!r) return 'fail'
        const branches = extractBranches(r.text)
        if (!branches?.length) return finishFail(r.run, 'No branches could be parsed from the model output.')
        const { evaluated, pick } = chooseBranch(S().spec, branches, R().registry, fallback())
        S().loadDesign(pick.design)
        S().set({ branches: evaluated, pickedBranch: String(pick.branch.branch_id ?? '') })
        const notes = evaluated.map(e => `Branch ${e.branch.branch_id ?? '?'}: ${e.card.verdict}${e.branch.recommended ? ' (model recommended)' : ''}${e.branch._material_dropped !== undefined ? ` · dropped material "${e.branch._material_dropped}"` : ''}`)
        const cited = R().registry.precedents.filter(p => r.text.includes(p.id)).map(p => p.id)
        notes.push(cited.length ? `Cites precedents: ${cited.join(', ')}` : 'Rationale cites no precedent IDs (grounding check failed).')
        r.run.notes = notes
        return finishOk(r.run, `${evaluated.length} branches · picked ${pick.branch.branch_id ?? '?'} (${pick.card.verdict})`)
      }
      case '4': {
        const r = await llm('4', { iteration: opts.iteration })
        if (!r) return 'fail'
        const script = r.text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()
        const checks = (R().registry.parts[S().partType]?.cadChecks ?? []).map(c => {
          let ok = false
          try { ok = new RegExp(c.pattern, c.flags).test(script) } catch { /* bad pattern */ }
          return { label: c.label, ok }
        })
        S().set({ cad: { script, checks } })
        r.run.notes = checks.map(c => `${c.ok ? 'PASS' : 'FAIL'} · ${c.label}`)
        return finishOk(r.run, `Script ${script.split('\n').length} lines · ${checks.filter(c => c.ok).length}/${checks.length} static checks`)
      }
      case '5': return gate(opts.iteration ?? 1)
      case '7': return refine()
      default: return 'ok'
    }
  } finally {
    R().set({ runningStage: null })
  }
}

function finishOk(run: Run, msg: string): Outcome {
  run.ok = true
  S().addRun(run); S().setStatus(run.stage, 'done'); S().log(run.stage, 'ok', msg)
  return 'ok'
}
function finishFail(run: Run, msg: string): Outcome {
  run.ok = false; run.error = { title: 'Output rejected', detail: msg, hint: 'Re-run the stage, lower the temperature, or edit the prompt.' }
  S().addRun(run); S().setStatus(run.stage, 'error'); S().log(run.stage, 'error', msg)
  toast.error(`Stage ${run.stage} · output rejected`, msg)
  return 'fail'
}

const embCache = new Map<string, number[]>()
async function cachedEmbed(model: string, text: string) {
  const k = model + ' ' + text
  if (!embCache.has(k)) embCache.set(k, await embed(model, text, controller?.signal))
  return embCache.get(k)!
}

/* ---------------- Stage 5 gate ---------------- */
async function gate(iteration: number): Promise<Outcome> {
  const s = S(), d = designOf(s), label = R().registry.parts[d.part_type]?.label ?? d.part_type
  s.setStatus('5', 'running')
  const card = validateDesign(d, label)
  const run: Run = { id: uid(), stage: '5', ts: Date.now(), ok: card.verdict === 'accept', user: JSON.stringify(d, null, 2), iteration, model: 'deterministic' }
  let remote: any = null
  try { remote = await validateRemote(d) } catch { /* backend optional */ }
  const notes = [`Browser engine: ${card.verdict.toUpperCase()} (score ${card.score})`]
  if (remote) {
    const rv = String(remote.verdict ?? remote.result?.verdict ?? '').toLowerCase()
    notes.push(rv ? `Python engine: ${rv.toUpperCase()}${rv && !rv.startsWith(card.verdict.slice(0, 3)) ? ' — MISMATCH, investigate' : ' — agrees'}` : 'Python engine: responded')
  } else notes.push('Python engine: not reachable (browser mirror only)')
  run.output = JSON.stringify({ verdict: card.verdict, score: card.score, computed: card.computed, failing: card.checks.filter(c => !c.pass).map(c => c.id) }, null, 2)
  run.notes = notes
  const { route, failing } = classifyFailure(card)
  S().set({ loop: { ...S().loop, history: [...S().loop.history, { iteration, verdict: card.verdict, route, failing, hints: repairHints(card, d), ts: Date.now() }] } })
  S().addRun(run)
  if (card.verdict === 'accept') { S().setStatus('5', 'done'); S().set({ feedback: { stage1: null, stage3: null } }); S().log('5', 'ok', `ACCEPT · score ${card.score}`); return 'ok' }
  if (card.verdict === 'unvalidated') { S().setStatus('5', 'blocked'); S().log('5', 'warn', 'UNVALIDATED — no physics for this part type'); return 'fail' }
  S().setStatus('5', 'error')
  S().log('5', 'warn', `REJECT · ${failing.join(', ')} → route ${route === 'stage1' ? 'Stage 1 (spec conflict)' : 'Stage 3 (geometry)'}`)
  const packet = feedbackPacket(card, d, iteration, label)
  S().set({ feedback: route === 'stage1' ? { stage1: packet, stage3: null } : { stage1: null, stage3: packet } })
  return 'fail'
}

/* ---------------- Stage 7 refinement ---------------- */
async function refine(): Promise<Outcome> {
  const s = S()
  if (!s.refine?.instruction?.trim()) { toast.warning('Type an edit instruction first'); return 'fail' }
  const before = designOf(s)
  const r = await llm('7', { json: true })
  if (!r) return 'fail'
  const j = parseJSON(r.text)
  if (!j?.delta || typeof j.delta !== 'object') return finishFail(r.run, 'No "delta" object in the model output.')
  const known = new Set(Object.keys(before)), delta: Record<string, any> = {}, ignored: string[] = []
  for (const [k, v] of Object.entries(j.delta)) (known.has(k) && k !== 'part_type' ? (delta[k] = v) : ignored.push(k))
  const drift: string[] = []
  if (j.unchanged && typeof j.unchanged === 'object' && !Array.isArray(j.unchanged)) {
    for (const [k, v] of Object.entries(j.unchanged)) if (known.has(k) && String(before[k]) !== String(v)) drift.push(k)
  }
  for (const [k, v] of Object.entries(delta)) S().setParam(k, typeof before[k] === 'number' ? Number(v) : v)
  S().set({ refine: { instruction: s.refine.instruction, delta, drift, ignored } })
  const card = validateDesign(designOf(S()))
  r.run.notes = [`Delta: ${Object.entries(delta).map(([k, v]) => `${k} ${before[k]} → ${v}`).join(', ') || 'none'}`,
    ignored.length ? `Ignored unknown keys: ${ignored.join(', ')}` : 'No unknown keys', drift.length ? `DRIFT on untouched fields: ${drift.join(', ')} — reject` : 'No silent drift',
    `Stage 5 recheck: ${card.verdict.toUpperCase()}`]
  if (drift.length) return finishFail(r.run, `Silent drift on ${drift.join(', ')}`)
  return finishOk(r.run, `Applied ${Object.keys(delta).length} change(s) · recheck ${card.verdict}`)
}

/* ---------------- whole pipeline ---------------- */
const ORDER: StageId[] = ['1', '2', '3', '4', '5']
export async function runPipeline(from: StageId = '1') {
  if (R().running) return
  controller = new AbortController()
  R().set({ running: true })
  const start = Math.max(0, ORDER.indexOf(from))
  S().set({ loop: { ...S().loop, history: start <= 4 ? [] : S().loop.history }, feedback: { stage1: null, stage3: null } })
  for (const id of ORDER.slice(start)) if (id !== from) S().setStatus(id, 'stale')
  S().log('sys', 'info', `Pipeline started from Stage ${from}`)
  try {
    for (const id of ORDER.slice(start)) {
      if (controller.signal.aborted) return
      S().set({ selected: id })
      const out = await runStage(id, { iteration: 1 })
      if (out !== 'ok' && id !== '5') { S().log('sys', 'warn', `Pipeline stopped at Stage ${id}`); return }
      if (id === '5' && out !== 'ok') await feedbackLoop()
    }
    const v = validateDesign(designOf(S())).verdict
    S().log('sys', v === 'accept' ? 'ok' : 'warn', `Pipeline finished · ${v.toUpperCase()}`)
    if (v === 'accept') { toast.success('Pipeline complete — design accepted', 'Review it, then publish a customer link from Stage 6.'); S().setStatus('6', 'idle') }
  } finally {
    R().set({ running: false, runningStage: null })
    controller = null
  }
}

async function feedbackLoop() {
  const { enabled, max } = S().loop
  if (!enabled) return
  for (let it = 2; it <= max; it++) {
    if (controller?.signal.aborted) return
    const fb = S().feedback
    if (fb.stage1) {
      S().log('sys', 'info', `Loop ${it}: spec conflict → re-running Stage 1 to raise customer questions`)
      S().set({ selected: '1' })
      await runStage('1', { iteration: it })
      S().log('sys', 'warn', 'Stopped: the conflict needs a customer decision. Publish with open questions from Stage 6.')
      S().setStatus('5', 'blocked')
      toast.warning('Needs a customer decision', 'The requirement conflicts with standards. Open questions were added for the customer.')
      return
    }
    if (!fb.stage3) return
    S().log('sys', 'info', `Loop ${it}: geometry failure → Stage 3 with computed corrections`)
    for (const id of ['3', '4', '5'] as StageId[]) {
      S().set({ selected: id })
      const out = await runStage(id, { iteration: it })
      if (out === 'stop' || controller?.signal.aborted) return
      if (out !== 'ok' && id !== '5') return
      if (id === '5' && out === 'ok') { S().log('sys', 'ok', `Converged on iteration ${it}`); return }
    }
  }
  S().log('sys', 'warn', `Loop exhausted after ${max} iterations — engineer review needed`)
}

export function stopPipeline() {
  controller?.abort()
  S().log('sys', 'warn', 'Stopped by user')
  const st = { ...S().status }
  for (const k of Object.keys(st) as StageId[]) if (st[k] === 'running') st[k] = 'error'
  S().set({ status: st })
  R().set({ running: false, runningStage: null })
  controller = null
}

/* ---------------- Stage 6 hand-off ---------------- */
/** Allowlist only: no cost, tolerances, score, ranking or model output crosses to the customer. */
export function customerPayload(): CustomerPayload {
  const s = S(), reg = R().registry, d = designOf(s), T = reg.parts[d.part_type]
  const allowed = new Set([...Object.keys(T?.defaults ?? {}), ...COMMON_KEYS])
  const design: Design = { part_type: d.part_type }
  for (const k of allowed) if (d[k] !== undefined) design[k] = d[k]
  const spec: Record<string, any> = {}
  for (const [k, v] of Object.entries(s.spec ?? {})) if (allowed.has(k) && v !== null && v !== undefined) spec[k] = v
  const card = validateDesign(design, T?.label)
  const questions = [...(s.spec?.unresolved_questions ?? [])]
  return { version: 3, part_type: d.part_type, label: T?.label ?? d.part_type, summary: T?.summary ?? '', design, spec,
    open_questions: [...new Set(questions)], verdict: card.verdict, created: new Date().toISOString() }
}
export async function publish(): Promise<string | null> {
  try {
    const prev = S().published
    const { id } = await publishDesign(customerPayload(), prev?.id)
    const url = `${location.origin}/customer?d=${id}`
    S().set({ published: { id, url, ts: Date.now() } }); S().setStatus('6', 'done'); S().log('6', 'ok', `Published customer link ${id}`)
    return url
  } catch (e: any) {
    toast.error('Could not publish', e?.message ?? String(e)); S().log('6', 'error', String(e?.message ?? e))
    return null
  }
}
