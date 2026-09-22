/**
 * Parameter slider: track + thumb + exact numeric entry + unit, with the validator's
 * safe zones painted on the track and a tick where the original (baseline) value sat.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as RSlider from '@radix-ui/react-slider'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { cn, Tip } from './primitives'
import type { Band } from '@/core/safezone'
import { roundToStep } from '@/core/safezone'

export interface ParamSliderProps {
  id: string
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
  bands?: Band[] | null
  baseline?: number
  help?: string
  lo?: string
  hi?: string
  failing?: boolean
  roomy?: boolean            // portal: bigger hit targets, stepper buttons, clamped entry
  onReset?: () => void
}

export function ParamSlider(p: ParamSliderProps) {
  const { value, min, max, step } = p
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const frac = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)))
  const changed = p.baseline !== undefined && Math.abs(p.baseline - value) > step / 2
  const inBand = useMemo(() => !p.bands || p.bands.some(b => frac(value) >= b.from - 1e-9 && frac(value) <= b.to + 1e-9), [p.bands, value])

  const commit = (raw: string) => {
    const x = parseFloat(raw)
    if (!Number.isFinite(x)) { setDraft(String(value)); return }
    const v = roundToStep(p.roomy ? Math.max(min, Math.min(max, x)) : x, step, 0)
    if (v !== value) p.onChange(v)
    else setDraft(String(value))
  }
  const nudge = (dir: 1 | -1) => p.onChange(roundToStep(Math.max(min, Math.min(max, value + dir * step)), step, 0))

  return (
    <div className={cn('group', p.roomy ? 'py-3' : 'py-2')} data-param={p.id}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`in-${p.id}`} className={cn('flex items-center gap-1.5 font-medium text-ink-2 min-w-0', p.roomy ? 'text-[14px] text-ink' : 'text-[12.5px]')}>
          <span className="truncate">{p.label}</span>
          {changed && <span className="size-1.5 rounded-full bg-accent-2 shrink-0" aria-label="changed" />}
          {p.failing && <span className="text-[11px] font-semibold text-danger">fails</span>}
        </label>
        <div className="flex items-center gap-1">
          {changed && p.onReset && (
            <Tip label={`Back to ${p.baseline}`}>
              <button onClick={p.onReset} className="grid size-6 place-items-center rounded-md text-ink-3 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ink hover:bg-surface-2 cursor-pointer" aria-label="Reset value"><RotateCcw className="size-3.5" /></button>
            </Tip>
          )}
          {p.roomy && <button onClick={() => nudge(-1)} className="grid size-8 place-items-center rounded-lg border border-border text-ink-2 hover:text-ink hover:border-border-strong cursor-pointer" aria-label="Decrease"><Minus className="size-4" /></button>}
          <div className={cn('flex items-center rounded-md border bg-surface-2 transition focus-within:border-accent',
            inBand ? 'border-border' : 'border-danger/50', p.roomy ? 'h-8' : 'h-7')}>
            <input id={`in-${p.id}`} inputMode="decimal" value={draft}
              onChange={e => setDraft(e.target.value)} onBlur={e => commit(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
                if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1) }
                if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1) }
              }}
              className={cn('num bg-transparent text-right font-mono text-ink outline-none', p.roomy ? 'w-16 px-2 text-[14px]' : 'w-14 px-1.5 text-[12.5px]')} />
            {p.unit && <span className="pr-2 text-[11.5px] text-ink-3">{p.unit}</span>}
          </div>
          {p.roomy && <button onClick={() => nudge(1)} className="grid size-8 place-items-center rounded-lg border border-border text-ink-2 hover:text-ink hover:border-border-strong cursor-pointer" aria-label="Increase"><Plus className="size-4" /></button>}
        </div>
      </div>

      <RSlider.Root min={min} max={max} step={step} value={[Math.max(min, Math.min(max, value))]}
        onValueChange={([v]) => p.onChange(roundToStep(v, step, 0))} aria-label={typeof p.label === 'string' ? p.label : p.id}
        className={cn('relative flex w-full touch-none select-none items-center cursor-pointer', p.roomy ? 'mt-3 h-6' : 'mt-1.5 h-5')}>
        <RSlider.Track className={cn('relative grow overflow-hidden rounded-full bg-surface-3', p.roomy ? 'h-2' : 'h-1.5')}>
          {p.bands?.map((b, i) => (
            <span key={i} className="absolute inset-y-0 bg-success/35" style={{ left: `${b.from * 100}%`, width: `${Math.max(0.6, (b.to - b.from) * 100)}%` }} />
          ))}
          <RSlider.Range className={cn('absolute h-full rounded-full', inBand ? 'bg-accent' : 'bg-danger')} />
        </RSlider.Track>
        {p.baseline !== undefined && changed && (
          <span className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-ink-3" style={{ left: `${frac(p.baseline) * 100}%` }} aria-hidden />
        )}
        <RSlider.Thumb className={cn('block rounded-full border-2 bg-white shadow-md outline-none transition-transform hover:scale-110 focus-visible:ring-4 focus-visible:ring-accent-soft',
          inBand ? 'border-accent' : 'border-danger', p.roomy ? 'size-5.5' : 'size-4')} />
      </RSlider.Root>

      {(p.lo || p.hi) && (
        <div className="mt-1 flex justify-between text-[11.5px] text-ink-3"><span>{p.lo}</span><span>{p.hi}</span></div>
      )}
      {p.help && <p className={cn('mt-1.5 text-ink-3 leading-relaxed', p.roomy ? 'text-[12.5px]' : 'text-[11.5px]')}>{p.help}</p>}
    </div>
  )
}
