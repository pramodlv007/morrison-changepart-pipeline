/** No link? The portal becomes a friendly request form that lands in the engineers' inbox. */
import { useState } from 'react'
import { ArrowRight, Check, Hexagon, Send } from 'lucide-react'
import { MACHINES } from '@/core/standards'
import type { Registry } from '@/core/registry'
import { submitRequest } from '@/core/backend'
import { PORTAL_NAME } from '@/core/app'
import { Button, Card, cn, Field, Input, NativeSelect, Textarea } from '@/ui/primitives'
import { toast } from '@/ui/overlay'
import { MaterialPicker } from './Portal'

function PartGlyph({ k }: { k: string }) {
  const stroke = 'currentColor'
  if (k === 'feed_screw') return (
    <svg viewBox="0 0 64 64" className="size-12" fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round">
      <rect x="8" y="27" width="48" height="10" rx="3" />
      {[12, 22, 32, 42, 52].map(x => <path key={x} d={`M${x - 4} 16 C ${x + 4} 24, ${x - 4} 40, ${x + 4} 48`} />)}
    </svg>
  )
  if (k === 'guide_rail') return (
    <svg viewBox="0 0 64 64" className="size-12" fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round">
      <path d="M10 44 A 24 24 0 0 1 54 44" /><path d="M16 44 A 18 18 0 0 1 48 44" strokeDasharray="3 4" />
      {[20, 32, 44].map(x => <circle key={x} cx={x} cy={x === 32 ? 30 : 36} r="4" />)}
    </svg>
  )
  return (
    <svg viewBox="0 0 64 64" className="size-12" fill="none" stroke={stroke} strokeWidth="2.4">
      <circle cx="32" cy="32" r="24" /><circle cx="32" cy="32" r="5" />
      {Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return <circle key={i} cx={32 + 16 * Math.cos(a)} cy={32 + 16 * Math.sin(a)} r="4.5" /> })}
    </svg>
  )
}

export function Intake({ registry }: { registry: Registry }) {
  const parts = Object.values(registry.parts)
  const [part, setPart] = useState(parts[0]?.key ?? 'starwheel')
  const [f, setF] = useState({ machine_id: 'CAP-16', target_speed_cpm: '', bottle_diameter_mm: '', bottle_height_mm: '', material_id: 'UHMW-PE', notes: '', contact: '', company: '' })
  const [busy, setBusy] = useState(false), [done, setDone] = useState<string | null>(null)
  const up = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }))
  const valid = /\S+@\S+\.\S+/.test(f.contact)

  const submit = async () => {
    if (!valid) { toast.warning('Add your email', 'So our engineers can send you the design.'); return }
    setBusy(true)
    try {
      const { id } = await submitRequest({ contact: f.contact, company: f.company, part_type: part, notes: f.notes,
        details: { machine: f.machine_id, line_speed_cpm: f.target_speed_cpm, container_diameter_mm: f.bottle_diameter_mm, container_height_mm: f.bottle_height_mm, material: f.material_id } })
      setDone(id)
    } catch (e: any) { toast.error('Could not send your request', e?.message ?? 'Please try again.') } finally { setBusy(false) }
  }

  if (done) return (
    <Shell>
      <div className="mx-auto max-w-lg py-16 text-center animate-in" data-testid="intake-done">
        <div className="mx-auto grid size-20 place-items-center rounded-3xl bg-gradient-accent text-white shadow-[0_18px_40px_-12px_var(--accent)]"><Check className="size-10" strokeWidth={2.6} /></div>
        <h1 className="mt-6 text-[32px] font-semibold tracking-tight text-ink">Request received</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-ink-2">Our engineers will design your part, check it against your machine and send you a link to review it in 3D.</p>
        <p className="mt-4 font-mono text-[12.5px] text-ink-3">Reference {done}</p>
      </div>
    </Shell>
  )

  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 text-center animate-in">
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-accent">New request</div>
          <h1 className="mt-2 text-[34px] font-semibold leading-tight tracking-tight text-ink sm:text-[44px]">Tell us about <span className="text-gradient">your line</span></h1>
          <p className="mx-auto mt-3 max-w-xl text-[16px] leading-relaxed text-ink-2">A few details are enough. Leave anything you are unsure of blank — we’ll ask.</p>
        </div>

        <section className="mb-8">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">1 · Which part do you need?</h2>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Part type">
            {parts.map(p => (
              <button key={p.key} role="radio" aria-checked={part === p.key} onClick={() => setPart(p.key)} data-part={p.key}
                className={cn('flex flex-col items-start gap-3 rounded-2xl border bg-white p-5 text-left transition cursor-pointer',
                  part === p.key ? 'border-accent ring-4 ring-accent/15 text-accent' : 'border-border text-ink-3 hover:border-border-strong')}>
                <PartGlyph k={p.key} />
                <span className="text-[15px] font-semibold text-ink">{p.label.replace(/\s*\(.*\)/, '')}</span>
                <span className="text-[12.5px] leading-relaxed text-ink-2">{p.summary}</span>
              </button>
            ))}
          </div>
        </section>

        <Card className="mb-8 p-6">
          <h2 className="mb-4 text-[15px] font-semibold text-ink">2 · Your line</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Machine"><NativeSelect aria-label="Machine" className="h-11 w-full" value={f.machine_id} onChange={v => up('machine_id', v)} options={Object.values(MACHINES).map(m => ({ value: m.id, label: m.id }))} /></Field>
            <Field label="Line speed" hint="Containers per minute"><Input className="h-11" inputMode="numeric" value={f.target_speed_cpm} onChange={e => up('target_speed_cpm', e.target.value)} placeholder="e.g. 380" /></Field>
            <Field label="Container diameter" hint="mm, across the widest point"><Input className="h-11" inputMode="decimal" value={f.bottle_diameter_mm} onChange={e => up('bottle_diameter_mm', e.target.value)} placeholder="e.g. 66" /></Field>
            <Field label="Container height" hint="mm"><Input className="h-11" inputMode="decimal" value={f.bottle_height_mm} onChange={e => up('bottle_height_mm', e.target.value)} placeholder="e.g. 210" /></Field>
          </div>
          <div className="mt-5"><div className="mb-2 text-[12.5px] font-medium text-ink-2">Material</div><MaterialPicker value={f.material_id} onChange={v => up('material_id', v)} /></div>
          <Field label="Anything else?" className="mt-5"><Textarea className="min-h-24" value={f.notes} onChange={e => up('notes', e.target.value)} placeholder="Old drawing numbers, problems with the current part, deadlines…" /></Field>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-[15px] font-semibold text-ink">3 · Where should we send the design?</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email"><Input className="h-11" type="email" value={f.contact} onChange={e => up('contact', e.target.value)} placeholder="you@company.com" aria-invalid={!!f.contact && !valid} /></Field>
            <Field label="Company (optional)"><Input className="h-11" value={f.company} onChange={e => up('company', e.target.value)} /></Field>
          </div>
          <Button variant="gradient" size="lg" className="mt-6 w-full sm:w-auto" icon={<Send className="size-4" />} loading={busy} onClick={submit} data-testid="submit-request">
            Send request <ArrowRight className="size-4" />
          </Button>
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
      <main className="px-4 py-10 sm:px-6 sm:py-14">{children}</main>
    </div>
  )
}
