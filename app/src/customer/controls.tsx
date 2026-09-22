/** Customer-side building blocks shared by the review flow and the request configurator. */
import { useEffect, useState, type ReactNode } from 'react'
import { CircleX, PencilLine, ShieldCheck } from 'lucide-react'
import type { Scorecard } from '@/core/validate'
import { Card, cn } from '@/ui/primitives'
import { FIELD_WORDS, fmtValue } from './words'

export function ReqCard({ label, changed, children, className }: { label: string; changed?: boolean; children: ReactNode; className?: string }) {
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

/** Big touch-friendly number entry with − / + steppers. Commits on Enter or blur. */
export function NumberStepper({ label, value, onChange, step, min, max, unit, compact }:
  { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number; unit?: string; compact?: boolean }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (x: number) => {
    if (!Number.isFinite(x)) { setDraft(String(value)); return }
    const v = Math.max(min, Math.min(max, Math.round(x / step) * step))
    const r = Number(v.toFixed(3))
    if (r !== value) onChange(r); else setDraft(String(value))
  }
  const h = compact ? 'h-10' : 'h-11'
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => commit(value - step)} className={cn('grid shrink-0 place-items-center rounded-xl border border-border text-[20px] text-ink-2 hover:border-border-strong cursor-pointer', h, compact ? 'w-10' : 'w-11')}>−</button>
      <div className={cn('flex min-w-0 flex-1 items-center rounded-xl border border-border bg-surface-2 px-3 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft', h)}>
        <input aria-label={label} inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} onBlur={e => commit(parseFloat(e.target.value))}
          onKeyDown={e => e.key === 'Enter' && commit(parseFloat((e.target as HTMLInputElement).value))}
          className={cn('num w-full min-w-0 bg-transparent font-semibold text-ink outline-none', compact ? 'text-[16px]' : 'text-[18px]')} />
        {unit && <span className="whitespace-nowrap text-[12.5px] text-ink-3">{unit}</span>}
      </div>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => commit(value + step)} className={cn('grid shrink-0 place-items-center rounded-xl border border-border text-[20px] text-ink-2 hover:border-border-strong cursor-pointer', h, compact ? 'w-10' : 'w-11')}>+</button>
    </div>
  )
}

export function RotationToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={FIELD_WORDS.handedness.label}>
      {['RH', 'LH'].map(h => {
        const on = String(value).toUpperCase().startsWith(h[0])
        return (
          <button key={h} type="button" role="radio" aria-checked={on} onClick={() => onChange(h)}
            className={cn('h-11 rounded-xl border text-[14px] font-medium transition cursor-pointer', on ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-2 hover:border-border-strong')}>
            {fmtValue('handedness', h)}
          </button>
        )
      })}
    </div>
  )
}

/** "Everything checks out" / "This setting will not work yet" — the customer's live verdict. */
export function LiveStatus({ card }: { card: Scorecard }) {
  const failing = card.checks.filter(c => !c.pass)
  const ok = card.verdict === 'accept'
  return (
    <Card className={cn('p-5', ok ? 'bg-gradient-to-br from-white to-[color-mix(in_srgb,var(--success)_7%,white)]' : 'bg-gradient-to-br from-white to-[color-mix(in_srgb,var(--danger)_6%,white)]')} data-testid="live-status">
      <div className="flex items-start gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-2xl text-white', ok ? 'bg-success' : card.verdict === 'unvalidated' ? 'bg-warning' : 'bg-danger')}>
          {ok ? <ShieldCheck className="size-5" /> : <CircleX className="size-5" />}
        </span>
        <div>
          <div className="text-[16px] font-semibold text-ink">{ok ? 'Everything checks out' : card.verdict === 'unvalidated' ? 'Checks being set up' : 'This setting will not work yet'}</div>
          <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">{ok ? `All ${card.checks.length} engineering checks pass for your line.` : failing[0]?.plainReason}</p>
          {failing.length > 1 && <p className="mt-1 text-[12.5px] text-ink-3">+ {failing.length - 1} more: {failing.slice(1).map(f => f.plainReason.replace(/\.$/, '').toLowerCase()).join('; ')}.</p>}
        </div>
      </div>
    </Card>
  )
}

/** Undo/redo stack for a design-edits object, coalescing continuous drags on one control. */
export function useEditHistory(initial: Record<string, any> = {}) {
  const [state, setState] = useState<{ edits: Record<string, any>; past: Record<string, any>[]; future: Record<string, any>[]; last: { k: string; t: number } | null }>(
    { edits: initial, past: [], future: [], last: null })
  return {
    edits: state.edits,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    edit: (k: string, v: any) => setState(s => {
      if (String(s.edits[k]) === String(v)) return s
      const now = Date.now(), coalesce = s.last?.k === k && now - s.last.t < 700
      return { edits: { ...s.edits, [k]: v }, past: coalesce ? s.past : [...s.past, s.edits].slice(-60), future: [], last: { k, t: now } }
    }),
    undo: () => setState(s => s.past.length ? { edits: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.edits, ...s.future], last: null } : s),
    redo: () => setState(s => s.future.length ? { edits: s.future[0], future: s.future.slice(1), past: [...s.past, s.edits], last: null } : s),
    replace: (edits: Record<string, any>) => setState({ edits, past: [], future: [], last: null }),
  }
}
