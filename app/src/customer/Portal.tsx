/** Customer design review: four calm steps, no jargon, every change checked live. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, Check, CircleCheck, CircleX, Download, Hexagon, MessageSquare, PencilLine, Printer, Redo2, RotateCcw, Send, ShieldCheck, SlidersHorizontal, Sparkles, ThumbsUp, Undo2,
} from 'lucide-react'
import { validateDesign, type Design } from '@/core/validate'
import { FOOD_SAFE_MATERIALS, MACHINES, MATERIALS } from '@/core/standards'
import { BUNDLED_REGISTRY, type PartType, type Registry, type SliderDef } from '@/core/registry'
import { safeBands } from '@/core/safezone'
import { respond } from '@/core/backend'
import { PORTAL_NAME } from '@/core/app'
import { MATERIAL_BLURB } from '@/cad/geometry'
import { drawingSvg, downloadText } from '@/cad/drawing'
import { Viewer, type Tool } from '@/cad/Viewer'
import { ParamSlider } from '@/ui/ParamSlider'
import { Button, Card, cn, IconButton, NativeSelect, Textarea } from '@/ui/primitives'
import { toast } from '@/ui/overlay'
import { currentOf, usePortal, type Step } from './store'
import { dimLabel, FIELD_WORDS, fmtValue, MATERIAL_SWATCH } from './words'

const STEPS: { id: Step; label: string; hint: string }[] = [
  { id: 'requirements', label: 'Requirements', hint: 'What you asked for' },
  { id: 'design', label: 'Design', hint: 'See and adjust it' },
  { id: 'checks', label: 'Checks', hint: 'Why it will work' },
  { id: 'approve', label: 'Approve', hint: 'Sign off or ask' },
]
const PORTAL_TOOLS: Tool[] = ['handles', 'hotspots', 'rotate', 'explode', 'containers', 'compare', 'drawing', 'fullscreen']

export function Portal({ registry }: { registry: Registry }) {
  const record = usePortal(s => s.record)!, step = usePortal(s => s.step), setStep = usePortal(s => s.setStep), edits = usePortal(s => s.edits)
  const undo = usePortal(s => s.undo), redo = usePortal(s => s.redo)
  const P = record.payload, part = registry.parts[P.part_type] ?? BUNDLED_REGISTRY.parts[P.part_type]
  const design = useMemo(() => currentOf(record, edits)!, [record, edits])
  const card = useMemo(() => validateDesign(design, part?.label), [design, part])
  const idx = STEPS.findIndex(s => s.id === step)

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [undo, redo])

  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 z-30 border-b border-border bg-white/80 backdrop-blur-xl no-print">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-xl bg-gradient-accent text-white shadow-[0_6px_18px_-6px_var(--accent)]"><Hexagon className="size-4.5" strokeWidth={2.4} /></span>
            <div className="leading-tight">
              <div className="text-[14px] font-semibold text-ink">{PORTAL_NAME}</div>
              <div className="text-[12px] text-ink-3">{part?.label ?? P.label}</div>
            </div>
          </div>
          <nav aria-label="Progress" className="mx-auto hidden md:block">
            <ol className="flex items-center gap-1">
              {STEPS.map((s, i) => (
                <li key={s.id} className="flex items-center">
                  <button onClick={() => setStep(s.id)} aria-current={s.id === step ? 'step' : undefined} data-step={s.id}
                    className={cn('flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-[13px] font-medium transition cursor-pointer',
                      s.id === step ? 'bg-accent-soft text-accent' : i < idx ? 'text-ink hover:bg-surface-2' : 'text-ink-3 hover:bg-surface-2')}>
                    <span className={cn('grid size-6 place-items-center rounded-full text-[12px] font-semibold',
                      s.id === step ? 'bg-accent text-white' : i < idx ? 'bg-success text-white' : 'bg-surface-3 text-ink-3')}>
                      {i < idx ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                    </span>
                    {s.label}
                  </button>
                  {i < STEPS.length - 1 && <span className={cn('mx-1 h-px w-6', i < idx ? 'bg-success' : 'bg-border')} />}
                </li>
              ))}
            </ol>
          </nav>
          <div className="ml-auto md:ml-0"><StatusChip ok={card.verdict === 'accept'} pending={card.verdict === 'unvalidated'} /></div>
        </div>
        <div className="h-1 bg-surface-2 md:hidden"><div className="h-full bg-gradient-accent transition-[width] duration-500" style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} /></div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 pb-28 pt-6 sm:px-6 sm:pt-10">
        <div className="mb-6 md:hidden text-[12px] font-semibold uppercase tracking-wider text-accent">Step {idx + 1} of 4 · {STEPS[idx].label}</div>
        {step === 'requirements' && <Requirements part={part} design={design} />}
        {step === 'design' && <DesignStep part={part} design={design} />}
        {step === 'checks' && <ChecksStep part={part} design={design} />}
        {step === 'approve' && <ApproveStep part={part} design={design} />}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white/90 backdrop-blur-xl no-print">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-3 px-4 sm:px-6">
          <Button variant="ghost" icon={<ArrowLeft className="size-4" />} disabled={idx === 0} onClick={() => setStep(STEPS[idx - 1].id)}>Back</Button>
          <span className="hidden text-[13px] text-ink-3 sm:block">{STEPS[idx].hint}</span>
          {idx < STEPS.length - 1 && (
            <Button variant="gradient" size="lg" className="ml-auto" onClick={() => setStep(STEPS[idx + 1].id)} data-testid="next">
              {idx === 0 ? 'Looks right — see the design' : idx === 1 ? 'Review the checks' : 'Continue to approval'}<ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}

function StatusChip({ ok, pending }: { ok: boolean; pending: boolean }) {
  return (
    <span className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold', pending ? 'bg-warning-soft text-warning' : ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')} data-testid="status-chip">
      {ok ? <ShieldCheck className="size-4" /> : <CircleX className="size-4" />}
      {pending ? 'Checks pending' : ok ? 'All checks pass' : 'Needs attention'}
    </span>
  )
}

function StepHeading({ eyebrow, title, body }: { eyebrow: string; title: ReactNode; body: ReactNode }) {
  return (
    <div className="mb-8 max-w-2xl animate-in">
      <div className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-accent">{eyebrow}</div>
      <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight text-ink sm:text-[38px]">{title}</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{body}</p>
    </div>
  )
}

/* ================= Step 1: requirements ================= */
function Requirements({ part, design }: { part?: PartType; design: Design }) {
  const record = usePortal(s => s.record)!, edit = usePortal(s => s.edit), answers = usePortal(s => s.answers), answer = usePortal(s => s.answer)
  const P = record.payload, original = P.design
  const changed = (k: string) => String(original[k]) !== String(design[k])
  return (
    <>
      <StepHeading eyebrow="Your requirements" title={<>Here’s what we understood <span className="text-gradient">from your request</span></>}
        body="Check these match your line. Change anything that is not right — the design updates and re-checks itself instantly." />
      {part && (
        <div className="mb-6 flex items-start gap-4 rounded-3xl border border-accent/15 bg-gradient-to-r from-[color-mix(in_srgb,var(--accent)_7%,white)] via-white to-[color-mix(in_srgb,var(--accent-3)_7%,white)] p-5 animate-in">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-accent shadow-card"><Sparkles className="size-5" /></span>
          <div>
            <div className="text-[13px] font-medium text-ink-3">What we are designing</div>
            <div className="text-[18px] font-semibold text-ink">{part.label.replace(/\s*\(.*\)/, '')}</div>
            <p className="mt-0.5 text-[14px] leading-relaxed text-ink-2">{part.summary}</p>
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <ReqCard label={FIELD_WORDS.machine_id.label} changed={changed('machine_id')}>
          <NativeSelect aria-label="Your machine" className="h-11 w-full text-[15px]" value={String(design.machine_id)} onChange={v => edit('machine_id', v)}
            options={Object.values(MACHINES).map(m => ({ value: m.id, label: m.id }))} />
          <p className="mt-2 text-[12.5px] text-ink-3">Rated up to {MACHINES[String(design.machine_id)]?.maxCpm ?? '—'} containers per minute.</p>
        </ReqCard>
        <NumberReq k="target_speed_cpm" design={design} changed={changed('target_speed_cpm')} step={10} min={30} max={1200} />
        <NumberReq k="bottle_diameter_mm" design={design} changed={changed('bottle_diameter_mm')} step={0.5} min={20} max={150} />
        <NumberReq k="bottle_height_mm" design={design} changed={changed('bottle_height_mm')} step={5} min={50} max={450} />
        <ReqCard label="Material" changed={changed('material_id')} className="lg:col-span-2">
          <MaterialPicker value={String(design.material_id)} onChange={v => edit('material_id', v)} />
        </ReqCard>
        {design.handedness !== undefined && (
          <ReqCard label={FIELD_WORDS.handedness.label} changed={changed('handedness')}>
            <div className="grid grid-cols-2 gap-2">
              {['RH', 'LH'].map(h => (
                <button key={h} onClick={() => edit('handedness', h)} className={cn('h-11 rounded-xl border text-[14px] font-medium transition cursor-pointer',
                  String(design.handedness).toUpperCase().startsWith(h[0]) ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-2 hover:border-border-strong')}>
                  {fmtValue('handedness', h)}
                </button>
              ))}
            </div>
          </ReqCard>
        )}
      </div>

      {P.open_questions.length > 0 && (
        <section className="mt-10 animate-in">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-accent-soft text-accent"><MessageSquare className="size-4" /></span>
            <h2 className="text-[20px] font-semibold text-ink">A few questions for you</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {P.open_questions.map(q => (
              <Card key={q} className="p-5">
                <label className="block">
                  <span className="text-[15px] font-medium text-ink">{q}</span>
                  <Textarea className="mt-3 min-h-20 bg-white" value={answers[q] ?? ''} onChange={e => answer(q, e.target.value)} placeholder="Your answer (optional)" />
                </label>
              </Card>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function ReqCard({ label, changed, children, className }: { label: string; changed?: boolean; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('p-5 transition', changed && 'ring-2 ring-accent-2/40', className)}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-2">{label}</span>
        {changed && <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--accent-2)_12%,transparent)] px-2 py-0.5 text-[11.5px] font-semibold text-accent-2"><PencilLine className="size-3" />Changed</span>}
      </div>
      {children}
    </Card>
  )
}

function NumberReq({ k, design, changed, step, min, max }: { k: string; design: Design; changed: boolean; step: number; min: number; max: number }) {
  const edit = usePortal(s => s.edit)
  const w = FIELD_WORDS[k], v = Number(design[k])
  const [draft, setDraft] = useState(String(v))
  useEffect(() => setDraft(String(v)), [v])
  const commit = (x: number) => { if (Number.isFinite(x)) edit(k, Math.max(min, Math.min(max, Math.round(x / step) * step))) }
  return (
    <ReqCard label={w.label} changed={changed}>
      <div className="flex items-center gap-2">
        <button aria-label={`Decrease ${w.label}`} onClick={() => commit(v - step)} className="grid size-11 place-items-center rounded-xl border border-border text-[20px] text-ink-2 hover:border-border-strong cursor-pointer">−</button>
        <div className="flex h-11 flex-1 items-center rounded-xl border border-border bg-surface-2 px-3 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft">
          <input aria-label={w.label} inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} onBlur={e => commit(parseFloat(e.target.value))}
            onKeyDown={e => e.key === 'Enter' && commit(parseFloat((e.target as HTMLInputElement).value))} className="num w-full bg-transparent text-[18px] font-semibold text-ink outline-none" />
          <span className="whitespace-nowrap text-[12.5px] text-ink-3">{w.unit}</span>
        </div>
        <button aria-label={`Increase ${w.label}`} onClick={() => commit(v + step)} className="grid size-11 place-items-center rounded-xl border border-border text-[20px] text-ink-2 hover:border-border-strong cursor-pointer">+</button>
      </div>
      {w.help && <p className="mt-2 text-[12.5px] text-ink-3">{w.help}</p>}
    </ReqCard>
  )
}

export function MaterialPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Material">
      {FOOD_SAFE_MATERIALS.map(m => {
        const on = m === value, sw = MATERIAL_SWATCH[m] ?? { color: '#eee', ring: '#ccc' }
        return (
          <button key={m} role="radio" aria-checked={on} onClick={() => onChange(m)} data-material={m}
            className={cn('group flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition cursor-pointer', on ? 'border-accent bg-accent-soft ring-2 ring-accent/20' : 'border-border hover:border-border-strong bg-white')}>
            <span className="flex w-full items-center justify-between">
              <span className="size-7 rounded-full border shadow-inner" style={{ background: `radial-gradient(circle at 30% 30%, #fff, ${sw.color} 60%)`, borderColor: sw.ring }} />
              {on && <CircleCheck className="size-4.5 text-accent" />}
            </span>
            <span className="text-[14px] font-semibold text-ink">{m}</span>
            <span className="text-[12px] leading-snug text-ink-3">{MATERIAL_BLURB[m] ?? MATERIALS[m]?.name}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ================= Step 2: design ================= */
function DesignStep({ part, design }: { part?: PartType; design: Design }) {
  const record = usePortal(s => s.record)!, edit = usePortal(s => s.edit), undo = usePortal(s => s.undo), redo = usePortal(s => s.redo), reset = usePortal(s => s.reset)
  const canUndo = usePortal(s => s.past.length > 0), canRedo = usePortal(s => s.future.length > 0), edits = usePortal(s => s.edits)
  const original = record.payload.design
  const [focus, setFocus] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const card = useMemo(() => validateDesign(design, part?.label), [design, part])
  const { controls, advanced, limits } = useMemo(() => {
    const controls = part?.customerControls ?? []
    const advanced: SliderDef[] = (part?.sliders ?? []).filter(s => !controls.some(c => c.k === s.k))
    return { controls, advanced, limits: [...controls, ...advanced] as SliderDef[] }
  }, [part])
  const bands = useMemo(() => Object.fromEntries(limits.map(s => [s.k, safeBands(design, s.k, s.min, s.max, 48)])), [design, limits])
  const failing = card.checks.filter(c => !c.pass)
  const dirty = Object.keys(edits).length > 0

  return (
    <>
      <StepHeading eyebrow="Your design" title={<>Shape it <span className="text-gradient">until it’s right</span></>}
        body="Drag the blue handles on the part or use the controls. Green on a slider means that setting passes every engineering check." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="lg:sticky lg:top-24 self-start">
          <Viewer design={design} label={part?.label ?? record.payload.label} theme="portal" tools={PORTAL_TOOLS} onParam={edit} limits={limits}
            compareTo={dirty ? original : null} hotspots={part?.hotspots} focusKey={focus} initial={{ rotate: false }}
            className="h-[min(62vh,620px)] min-h-[360px] rounded-3xl border border-border shadow-card"
            overlay={
              <div className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-xl border border-border bg-white/90 p-1 shadow-card backdrop-blur-md" role="toolbar" aria-label="History">
                <IconButton size="sm" label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Undo2 className="size-4" /></IconButton>
                <IconButton size="sm" label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}><Redo2 className="size-4" /></IconButton>
                <span className="mx-1 h-4 w-px bg-border" />
                <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} disabled={!dirty} onClick={reset}>Our proposal</Button>
              </div>
            } />
          <p className="mt-3 text-[12.5px] text-ink-3" aria-live="polite">{dirty ? `${Object.keys(edits).length} change${Object.keys(edits).length > 1 ? 's' : ''} from our proposal — the violet outline shows the original.` : 'Showing our proposal.'}</p>
        </div>

        <div className="space-y-4">
          <Card className={cn('p-5', card.verdict === 'accept' ? 'bg-gradient-to-br from-white to-[color-mix(in_srgb,var(--success)_7%,white)]' : 'bg-gradient-to-br from-white to-[color-mix(in_srgb,var(--danger)_6%,white)]')} data-testid="live-status">
            <div className="flex items-start gap-3">
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-2xl', card.verdict === 'accept' ? 'bg-success text-white' : 'bg-danger text-white')}>
                {card.verdict === 'accept' ? <ShieldCheck className="size-5" /> : <CircleX className="size-5" />}
              </span>
              <div>
                <div className="text-[16px] font-semibold text-ink">{card.verdict === 'accept' ? 'Everything checks out' : card.verdict === 'unvalidated' ? 'Checks being set up' : 'This setting will not work yet'}</div>
                <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">
                  {card.verdict === 'accept' ? `All ${card.checks.length} engineering checks pass for your line.` : failing[0]?.plainReason}
                </p>
                {failing.length > 1 && <p className="mt-1 text-[12.5px] text-ink-3">+ {failing.length - 1} more — see the Checks step.</p>}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-1 flex items-center gap-2"><Sparkles className="size-4 text-accent" /><h2 className="text-[15px] font-semibold text-ink">Adjust</h2></div>
            <div className="divide-y divide-border">
              {controls.map(c => (
                <div key={c.k} onPointerEnter={() => setFocus(c.k)} onPointerLeave={() => setFocus(null)}>
                  <ParamSlider roomy id={c.k} label={c.l} value={Number(design[c.k] ?? c.min)} min={c.min} max={c.max} step={c.step} unit={unitFor(c.k)}
                    lo={c.lo} hi={c.hi} help={c.help} bands={bands[c.k]} baseline={Number(original[c.k])} onReset={() => edit(c.k, original[c.k])}
                    onChange={v => edit(c.k, v)} />
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Material</h2>
            <MaterialPicker value={String(design.material_id)} onChange={v => edit('material_id', v)} />
          </Card>

          <Card className="overflow-hidden">
            <button onClick={() => setMore(v => !v)} className="flex w-full items-center gap-2 px-5 py-4 text-left cursor-pointer" aria-expanded={more}>
              <SlidersHorizontal className="size-4 text-ink-3" /><span className="text-[15px] font-semibold text-ink">More dimensions</span>
              <span className="ml-auto text-[12.5px] text-ink-3">{more ? 'Hide' : 'For detailed changes'}</span>
            </button>
            {more && (
              <div className="divide-y divide-border border-t border-border px-5">
                {advanced.map(s => (
                  <div key={s.k} onPointerEnter={() => setFocus(s.k)} onPointerLeave={() => setFocus(null)}>
                    <ParamSlider roomy id={s.k} label={dimLabel(part, s.k)} value={Number(design[s.k] ?? s.min)} min={s.min} max={s.max} step={s.step} unit={unitFor(s.k)}
                      bands={bands[s.k]} baseline={Number(original[s.k])} onReset={() => edit(s.k, original[s.k])} onChange={v => edit(s.k, v)} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Key dimensions</h2>
            <dl className="divide-y divide-border">
              {(part?.customerDims ?? []).map(d => {
                const ch = String(original[d.k]) !== String(design[d.k])
                return (
                  <div key={d.k} className="flex items-center justify-between py-2.5">
                    <dt className="text-[13.5px] text-ink-2">{d.l}</dt>
                    <dd className="num text-[14px] font-semibold text-ink">
                      {ch && <span className="mr-2 text-[12.5px] font-normal text-ink-3 line-through">{fmtValue(d.k, original[d.k])}</span>}
                      <span className={ch ? 'text-accent-2' : ''}>{fmtValue(d.k, design[d.k])}</span>
                    </dd>
                  </div>
                )
              })}
            </dl>
          </Card>
        </div>
      </div>
    </>
  )
}
const unitFor = (k: string) => (k.endsWith('_mm') ? 'mm' : k.endsWith('_deg') ? '°' : '')

/* ================= Step 3: checks ================= */
function ChecksStep({ part, design }: { part?: PartType; design: Design }) {
  const card = useMemo(() => validateDesign(design, part?.label), [design, part])
  const svg = useMemo(() => drawingSvg(design, part?.label ?? design.part_type, 'portal', 'customer'), [design, part])
  const passed = card.checks.filter(c => c.pass).length
  return (
    <>
      <StepHeading eyebrow="Engineering checks" title={card.verdict === 'accept' ? <>Built to run <span className="text-gradient">smoothly on your line</span></> : <>A few things <span className="text-gradient">need attention</span></>}
        body="Every design is checked with exact calculations against your machine’s ratings, your container, and food-contact rules. No guesswork." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-6">
          <div className="flex items-end justify-between">
            <div>
              <div className="num text-[44px] font-semibold leading-none tracking-tight text-ink">{passed}<span className="text-ink-3">/{card.checks.length}</span></div>
              <div className="mt-1 text-[13.5px] text-ink-2">checks passed</div>
            </div>
            <div className="h-2.5 w-40 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full transition-[width] duration-700', card.verdict === 'accept' ? 'bg-success' : 'bg-gradient-accent')} style={{ width: `${(passed / Math.max(1, card.checks.length)) * 100}%` }} /></div>
          </div>
          <ul className="mt-6 space-y-2.5" data-testid="plain-checks">
            {card.checks.map(c => (
              <li key={c.id} className={cn('flex gap-3 rounded-2xl p-3.5', c.pass ? 'bg-success-soft/60' : 'bg-danger-soft')}>
                {c.pass ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" /> : <CircleX className="mt-0.5 size-5 shrink-0 text-danger" />}
                <div>
                  <div className="text-[14.5px] font-medium text-ink">{c.plain}</div>
                  {!c.pass && <div className="mt-0.5 text-[13.5px] text-danger">{c.plainReason}</div>}
                </div>
              </li>
            ))}
          </ul>
          {card.verdict === 'reject' && <p className="mt-5 text-[13.5px] text-ink-2">Go back to <b>Design</b> and move the highlighted controls into the green, or tell us in the next step and our engineers will sort it out.</p>}
        </Card>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 className="text-[15px] font-semibold text-ink">Dimensioned drawing</h2>
            <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />} onClick={() => downloadText(`${design.part_type}-drawing.svg`, svg)}>Download</Button>
          </div>
          <div className="aspect-square bg-white [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} data-testid="portal-drawing" />
        </Card>
      </div>
    </>
  )
}

/* ================= Step 4: approve ================= */
function ApproveStep({ part, design }: { part?: PartType; design: Design }) {
  const s = usePortal()
  const record = s.record!, P = record.payload, original = P.design
  const card = useMemo(() => validateDesign(design, part?.label), [design, part])
  const [busy, setBusy] = useState<null | 'approve' | 'request'>(null)
  const changes = Object.keys(s.edits).filter(k => String(original[k]) !== String(s.edits[k]))
  const answered = P.open_questions.filter(q => s.answers[q]?.trim())

  const submit = async (kind: 'approve' | 'request') => {
    if (kind === 'request' && !s.message.trim() && !changes.length && !answered.length) { toast.warning('Tell us what to change', 'Write a short note or adjust the design first.'); return }
    setBusy(kind)
    try {
      await respond(record.id, { kind, text: s.message.trim(), adjustments: Object.fromEntries(changes.map(k => [k, s.edits[k]])), answers: answered.map(q => ({ q, a: s.answers[q].trim() })) })
      s.markSubmitted(kind)
    } catch (e: any) { toast.error('Could not send', e?.message ?? 'Please try again.') } finally { setBusy(null) }
  }

  if (s.submitted) return <Done kind={s.submitted} design={design} part={part} />

  return (
    <>
      <StepHeading eyebrow="Approval" title={<>Ready when <span className="text-gradient">you are</span></>}
        body="Approve the design to move it into production, or send it back with your changes. Our engineers review every response." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <Card className="p-6">
            <h2 className="text-[16px] font-semibold text-ink">Summary</h2>
            <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {[...(part?.customerDims ?? []).map(d => ({ k: d.k, l: d.l })), { k: 'material_id', l: 'Material' }, { k: 'machine_id', l: 'Machine' }, { k: 'target_speed_cpm', l: 'Line speed' }].map(({ k, l }) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-b border-border pb-2.5">
                  <dt className="text-[13.5px] text-ink-2">{l}</dt>
                  <dd className={cn('num text-[14px] font-semibold', changes.includes(k) ? 'text-accent-2' : 'text-ink')}>{fmtValue(k, design[k])}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {changes.length > 0 && (
            <Card className="p-6">
              <h2 className="text-[16px] font-semibold text-ink">Your changes</h2>
              <ul className="mt-3 space-y-2">
                {changes.map(k => (
                  <li key={k} className="flex flex-wrap items-center gap-2 text-[14px]">
                    <span className="text-ink-2">{dimLabel(part, k)}</span>
                    <span className="num text-ink-3 line-through">{fmtValue(k, original[k])}</span>
                    <ArrowRight className="size-3.5 text-ink-3" />
                    <span className="num font-semibold text-accent-2">{fmtValue(k, s.edits[k])}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="p-6 lg:sticky lg:top-24 self-start">
          <label className="block">
            <span className="text-[14px] font-semibold text-ink">Message to our engineers</span>
            <Textarea className="mt-2 min-h-32 bg-white text-[14.5px]" value={s.message} onChange={e => s.setMessage(e.target.value)} placeholder="Anything we should know? e.g. “We also run a 500 ml bottle on this line.”" aria-label="Message" />
          </label>
          {answered.length > 0 && <p className="mt-2 text-[12.5px] text-ink-3">Your {answered.length} answer{answered.length > 1 ? 's' : ''} to our questions will be included.</p>}
          <div className="mt-5 space-y-2.5">
            <Button variant="gradient" size="lg" className="w-full" icon={<ThumbsUp className="size-4.5" />} disabled={card.verdict !== 'accept'} loading={busy === 'approve'} onClick={() => submit('approve')} data-testid="approve">
              Approve design
            </Button>
            {card.verdict !== 'accept' && <p className="text-center text-[12.5px] text-ink-3">Approval unlocks once every check passes. You can still send your changes.</p>}
            <Button variant="secondary" size="lg" className="w-full" icon={<Send className="size-4" />} loading={busy === 'request'} onClick={() => submit('request')} data-testid="request">
              {changes.length ? 'Send my changes' : 'Ask for changes'}
            </Button>
          </div>
        </Card>
      </div>
    </>
  )
}

function Done({ kind, design, part }: { kind: 'approve' | 'request'; design: Design; part?: PartType }) {
  const svg = useMemo(() => drawingSvg(design, part?.label ?? design.part_type, 'portal', 'customer'), [design, part])
  return (
    <div className="mx-auto max-w-xl py-10 text-center animate-in" data-testid="done">
      <div className="mx-auto grid size-20 place-items-center rounded-3xl bg-gradient-accent text-white shadow-[0_18px_40px_-12px_var(--accent)]">
        {kind === 'approve' ? <ThumbsUp className="size-9" /> : <Send className="size-8" />}
      </div>
      <h1 className="mt-6 text-[32px] font-semibold tracking-tight text-ink">{kind === 'approve' ? 'Design approved' : 'Changes sent'}</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
        {kind === 'approve' ? 'Thank you. Our engineers will prepare the production files and confirm lead time with you.' : 'Thank you. Our engineers will review your changes, re-check the design and send you an updated version.'}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2 no-print">
        <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => downloadText(`${design.part_type}-drawing.svg`, svg)}>Download drawing</Button>
        <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print summary</Button>
      </div>
      <div className="mx-auto mt-8 max-w-md overflow-hidden rounded-2xl border border-border bg-white [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}
