/**
 * No link? The portal becomes a configurator: pick a part, describe the line, shape the part
 * in 3D with live engineering checks, and send the finished design to the engineers' inbox.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Hexagon, Redo2, RotateCcw, Send, SlidersHorizontal, Sparkles, Undo2 } from 'lucide-react'
import { MACHINES } from '@/core/standards'
import type { PartType, Registry, SliderDef } from '@/core/registry'
import { validateDesign, type Design } from '@/core/validate'
import { safeBands } from '@/core/safezone'
import { submitRequest } from '@/core/backend'
import { PORTAL_NAME } from '@/core/app'
import { Viewer, type Tool } from '@/cad/Viewer'
import { ParamSlider } from '@/ui/ParamSlider'
import { Button, Card, cn, Field, IconButton, Input, NativeSelect, Textarea } from '@/ui/primitives'
import { toast } from '@/ui/overlay'
import { MaterialPicker } from './Portal'
import { LiveStatus, NumberStepper, RotationToggle, useEditHistory } from './controls'
import { dimLabel, FIELD_WORDS, fmtValue } from './words'

const TOOLS: Tool[] = ['handles', 'hotspots', 'rotate', 'explode', 'containers', 'compare', 'drawing', 'fullscreen']
const COMMON = { machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380, bottle_diameter_mm: 54, bottle_height_mm: 210, ovality_mm: 0.6 }
const SAVE_KEY = 'cps-intake-v1'
const unitFor = (k: string) => (k.endsWith('_mm') ? 'mm' : k.endsWith('_deg') ? '°' : '')

export function baseDesign(part: PartType): Design {
  return { part_type: part.key, ...part.defaults, ...COMMON, ...part.commonDefaults }
}

function PartGlyph({ k }: { k: string }) {
  if (k === 'feed_screw') return (
    <svg viewBox="0 0 64 64" className="size-10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <rect x="8" y="27" width="48" height="10" rx="3" />
      {[12, 22, 32, 42, 52].map(x => <path key={x} d={`M${x - 4} 16 C ${x + 4} 24, ${x - 4} 40, ${x + 4} 48`} />)}
    </svg>
  )
  if (k === 'guide_rail') return (
    <svg viewBox="0 0 64 64" className="size-10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M10 44 A 24 24 0 0 1 54 44" /><path d="M16 44 A 18 18 0 0 1 48 44" strokeDasharray="3 4" />
      {[20, 32, 44].map(x => <circle key={x} cx={x} cy={x === 32 ? 30 : 36} r="4" />)}
    </svg>
  )
  return (
    <svg viewBox="0 0 64 64" className="size-10" fill="none" stroke="currentColor" strokeWidth="2.4">
      <circle cx="32" cy="32" r="24" /><circle cx="32" cy="32" r="5" />
      {Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return <circle key={i} cx={32 + 16 * Math.cos(a)} cy={32 + 16 * Math.sin(a)} r="4.5" /> })}
    </svg>
  )
}

function loadSaved(): { part?: string; edits?: Record<string, any>; contact?: string; company?: string; notes?: string } {
  try { return JSON.parse(sessionStorage.getItem(SAVE_KEY) ?? '{}') } catch { return {} }
}

export function Intake({ registry }: { registry: Registry }) {
  const parts = Object.values(registry.parts)
  const saved = useMemo(loadSaved, [])
  const [partKey, setPartKey] = useState(saved.part && registry.parts[saved.part] ? saved.part : parts[0]?.key ?? 'starwheel')
  const part = registry.parts[partKey]
  const h = useEditHistory(saved.part === partKey ? saved.edits ?? {} : {})
  const [contact, setContact] = useState(saved.contact ?? ''), [company, setCompany] = useState(saved.company ?? ''), [notes, setNotes] = useState(saved.notes ?? '')
  const [busy, setBusy] = useState(false), [done, setDone] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null), [more, setMore] = useState(false)

  const base = useMemo(() => baseDesign(part), [part])
  const design = useMemo(() => ({ ...base, ...h.edits }) as Design, [base, h.edits])
  const card = useMemo(() => validateDesign(design, part?.label), [design, part])
  const dirty = Object.keys(h.edits).length > 0
  const { controls, advanced, limits } = useMemo(() => {
    const controls = part?.customerControls ?? []
    const advanced: SliderDef[] = (part?.sliders ?? []).filter(s => !controls.some(c => c.k === s.k))
    return { controls, advanced, limits: [...controls, ...advanced] as SliderDef[] }
  }, [part])
  const bands = useMemo(() => Object.fromEntries(limits.map(s => [s.k, safeBands(design, s.k, s.min, s.max, 48)])), [design, limits])
  const valid = /\S+@\S+\.\S+/.test(contact)

  useEffect(() => {
    try { sessionStorage.setItem(SAVE_KEY, JSON.stringify({ part: partKey, edits: h.edits, contact, company, notes })) } catch { /* storage blocked */ }
  }, [partKey, h.edits, contact, company, notes])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || ['TEXTAREA', 'INPUT'].includes((e.target as HTMLElement)?.tagName)) return
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); h.undo() }
      if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') { e.preventDefault(); h.redo() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [h])

  const choosePart = (k: string) => { if (k === partKey) return; setPartKey(k); h.replace({}) }

  const submit = async () => {
    if (!valid) { toast.warning('Add your email', 'So our engineers can send you the reviewed design.'); document.querySelector<HTMLInputElement>('input[type=email]')?.focus(); return }
    setBusy(true)
    try {
      const dims = Object.fromEntries((part.customerDims ?? []).map(d => [dimLabel(part, d.k), fmtValue(d.k, design[d.k])]))
      const { id } = await submitRequest({
        contact, company, part_type: partKey, notes,
        details: { machine: design.machine_id, line_speed_cpm: design.target_speed_cpm, container_diameter_mm: design.bottle_diameter_mm, container_height_mm: design.bottle_height_mm, material: design.material_id, ...dims },
        design, verdict: card.verdict,
      })
      setDone(id)
      try { sessionStorage.removeItem(SAVE_KEY) } catch { /* ignore */ }
    } catch (e: any) { toast.error('Could not send your request', e?.message ?? 'Please try again.') } finally { setBusy(false) }
  }

  if (done) return (
    <Shell>
      <div className="mx-auto max-w-lg py-16 text-center animate-in" data-testid="intake-done">
        <div className="mx-auto grid size-20 place-items-center rounded-3xl bg-gradient-accent text-white shadow-[0_18px_40px_-12px_var(--accent)]"><Check className="size-10" strokeWidth={2.6} /></div>
        <h1 className="mt-6 text-[32px] font-semibold tracking-tight text-ink">Design sent</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-ink-2">Our engineers will review your {part.label.replace(/\s*\(.*\)/, '').toLowerCase()}, confirm it against your machine and send you a link to approve the final version.</p>
        <p className="mt-4 font-mono text-[12.5px] text-ink-3">Reference {done}</p>
        <Button className="mt-8" variant="secondary" onClick={() => { setDone(null); h.replace({}) }}>Configure another part</Button>
      </div>
    </Shell>
  )

  return (
    <Shell>
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-8 max-w-2xl animate-in">
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-accent">Configure your part</div>
          <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-tight text-ink sm:text-[42px]">Design it <span className="text-gradient">in minutes</span></h1>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-2">Pick a part, tell us about your line, and shape it in 3D. Every change is checked against your machine instantly — then send it to our engineers.</p>
        </div>

        {/* 1 · part */}
        <section className="mb-6" aria-labelledby="h-part">
          <h2 id="h-part" className="mb-3 text-[15px] font-semibold text-ink">1 · Choose a part</h2>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Part type">
            {parts.map(p => (
              <button key={p.key} type="button" role="radio" aria-checked={partKey === p.key} onClick={() => choosePart(p.key)} data-part={p.key}
                className={cn('flex items-start gap-4 rounded-2xl border bg-white p-4 text-left transition cursor-pointer',
                  partKey === p.key ? 'border-accent ring-4 ring-accent/15 text-accent' : 'border-border text-ink-3 hover:border-border-strong')}>
                <span className="shrink-0"><PartGlyph k={p.key} /></span>
                <span>
                  <span className="block text-[15px] font-semibold text-ink">{p.label.replace(/\s*\(.*\)/, '')}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-2 line-clamp-2">{p.summary}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 2 · line + 3 · shape, beside the editor */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="lg:sticky lg:top-6 self-start">
            <Viewer design={design} label={part.label} theme="portal" tools={TOOLS} onParam={h.edit} limits={limits} hotspots={part.hotspots}
              compareTo={dirty ? base : null} focusKey={focus} className="h-[min(66vh,640px)] min-h-[360px] rounded-3xl border border-border shadow-card"
              overlay={
                <div className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-xl border border-border bg-white/90 p-1 shadow-card backdrop-blur-md" role="toolbar" aria-label="History">
                  <IconButton size="sm" label="Undo (Ctrl+Z)" disabled={!h.canUndo} onClick={h.undo}><Undo2 className="size-4" /></IconButton>
                  <IconButton size="sm" label="Redo (Ctrl+Shift+Z)" disabled={!h.canRedo} onClick={h.redo}><Redo2 className="size-4" /></IconButton>
                  <span className="mx-1 h-4 w-px bg-border" />
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} disabled={!dirty} onClick={() => h.replace({})}>Start over</Button>
                </div>
              } />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="key-dims">
              {(part.customerDims ?? []).slice(0, 4).map(d => (
                <div key={d.k} className="rounded-2xl border border-border bg-white px-3.5 py-2.5">
                  <div className="truncate text-[11.5px] text-ink-3">{d.l}</div>
                  <div className={cn('num text-[15px] font-semibold', String(base[d.k]) !== String(design[d.k]) ? 'text-accent-2' : 'text-ink')}>{fmtValue(d.k, design[d.k])}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <LiveStatus card={card} />

            <Card className="p-5">
              <h2 className="mb-4 text-[15px] font-semibold text-ink">2 · Your line</h2>
              <div className="space-y-4">
                <Field label={FIELD_WORDS.machine_id.label} hint={`Rated up to ${MACHINES[String(design.machine_id)]?.maxCpm ?? '—'} containers per minute.`}>
                  <NativeSelect aria-label="Your machine" className="h-10 w-full" value={String(design.machine_id)} onChange={v => h.edit('machine_id', v)}
                    options={Object.values(MACHINES).map(m => ({ value: m.id, label: m.id }))} />
                </Field>
                {(['target_speed_cpm', 'bottle_diameter_mm', 'bottle_height_mm'] as const).map(k => {
                  const w = FIELD_WORDS[k], cfg = { target_speed_cpm: [10, 30, 1200], bottle_diameter_mm: [0.5, 20, 150], bottle_height_mm: [5, 50, 450] }[k]
                  return (
                    <div key={k}>
                      <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">{w.label}</div>
                      <NumberStepper compact label={w.label} value={Number(design[k])} onChange={v => h.edit(k, v)} step={cfg[0]} min={cfg[1]} max={cfg[2]} unit={w.unit} />
                    </div>
                  )
                })}
                {design.handedness !== undefined && (
                  <div><div className="mb-1.5 text-[12.5px] font-medium text-ink-2">{FIELD_WORDS.handedness.label}</div>
                    <RotationToggle value={String(design.handedness)} onChange={v => h.edit('handedness', v)} /></div>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-1 flex items-center gap-2"><Sparkles className="size-4 text-accent" /><h2 className="text-[15px] font-semibold text-ink">3 · Shape it</h2></div>
              <p className="text-[12.5px] text-ink-3">Or drag the blue handles on the part. Green on a slider means that setting passes every check.</p>
              <div className="divide-y divide-border">
                {controls.map(c => (
                  <div key={c.k} onPointerEnter={() => setFocus(c.k)} onPointerLeave={() => setFocus(null)}>
                    <ParamSlider roomy id={c.k} label={c.l} value={Number(design[c.k] ?? c.min)} min={c.min} max={c.max} step={c.step} unit={unitFor(c.k)}
                      lo={c.lo} hi={c.hi} help={c.help} bands={bands[c.k]} baseline={Number(base[c.k])} onReset={() => h.edit(c.k, base[c.k])} onChange={v => h.edit(c.k, v)} />
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-semibold text-ink">Material</h2>
              <MaterialPicker narrow value={String(design.material_id)} onChange={v => h.edit('material_id', v)} />
            </Card>

            <Card className="overflow-hidden">
              <button type="button" onClick={() => setMore(v => !v)} className="flex w-full items-center gap-2 px-5 py-4 text-left cursor-pointer" aria-expanded={more}>
                <SlidersHorizontal className="size-4 text-ink-3" /><span className="text-[15px] font-semibold text-ink">More dimensions</span>
                <span className="ml-auto text-[12.5px] text-ink-3">{more ? 'Hide' : 'For detailed changes'}</span>
              </button>
              {more && (
                <div className="divide-y divide-border border-t border-border px-5">
                  {advanced.map(s => (
                    <div key={s.k} onPointerEnter={() => setFocus(s.k)} onPointerLeave={() => setFocus(null)}>
                      <ParamSlider roomy id={s.k} label={dimLabel(part, s.k)} value={Number(design[s.k] ?? s.min)} min={s.min} max={s.max} step={s.step} unit={unitFor(s.k)}
                        bands={bands[s.k]} baseline={Number(base[s.k])} onReset={() => h.edit(s.k, base[s.k])} onChange={v => h.edit(s.k, v)} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* 4 · send */}
        <Card className="mt-6 p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <h2 className="text-[18px] font-semibold text-ink">4 · Send it to our engineers</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
                {card.verdict === 'accept' ? 'Your design passes every check. Our engineers will confirm it and send you a link to approve the final version.'
                  : 'Not everything passes yet — that’s fine. Send it anyway and our engineers will propose the closest design that works.'}
              </p>
              <Field label="Anything else?" className="mt-4"><Textarea className="min-h-24 bg-white" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Old drawing numbers, problems with the current part, deadlines…" /></Field>
            </div>
            <div className="space-y-4">
              <Field label="Email"><Input className="h-11 bg-white" type="email" value={contact} onChange={e => setContact(e.target.value)} placeholder="you@company.com" aria-invalid={!!contact && !valid} /></Field>
              <Field label="Company (optional)"><Input className="h-11 bg-white" value={company} onChange={e => setCompany(e.target.value)} /></Field>
              <Button variant="gradient" size="lg" className="w-full" icon={<Send className="size-4" />} loading={busy} onClick={submit} data-testid="submit-request">
                Send my design <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </Shell>
  )
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-bg">
      <header className="border-b border-border bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-2.5 px-4 sm:px-6">
          <span className="grid size-8 place-items-center rounded-xl bg-gradient-accent text-white"><Hexagon className="size-4.5" strokeWidth={2.4} /></span>
          <span className="text-[14px] font-semibold text-ink">{PORTAL_NAME}</span>
        </div>
      </header>
      <main className="px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </div>
  )
}
