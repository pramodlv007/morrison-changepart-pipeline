/**
 * Safe zones: sweep one parameter across its range with every other value held, and
 * ask the real Stage 5 validator which positions pass. The slider paints those runs
 * green, so a user sees *where* the design stays valid before they drag there.
 */
import { validateDesign, type Design } from './validate'
import { isImplemented } from './registry'

export interface Band { from: number; to: number }        // fractions 0..1 of the slider track

export function safeBands(d: Design, key: string, min: number, max: number, samples = 64): Band[] | null {
  if (!isImplemented(d.part_type) || !(max > min)) return null
  const bands: Band[] = []
  let start: number | null = null
  for (let i = 0; i <= samples; i++) {
    const f = i / samples
    const v = min + (max - min) * f
    const ok = validateDesign({ ...d, [key]: key === 'pocket_count' || key === 'starts' ? Math.round(v) : v }).verdict === 'accept'
    if (ok && start === null) start = f
    if (!ok && start !== null) { bands.push({ from: start, to: (i - 1) / samples }); start = null }
  }
  if (start !== null) bands.push({ from: start, to: 1 })
  return bands
}

/** Which checks a single value change would flip, for a "this breaks X" hint while dragging. */
export function flips(d: Design, key: string, value: number): { broke: string[]; fixed: string[] } {
  const a = validateDesign(d), b = validateDesign({ ...d, [key]: value })
  const pass = (c: typeof a, id: string) => c.checks.find(x => x.id === id)?.pass
  const ids = b.checks.map(c => c.id)
  return {
    broke: ids.filter(id => pass(a, id) && !pass(b, id)),
    fixed: ids.filter(id => !pass(a, id) && pass(b, id)),
  }
}

export const roundToStep = (v: number, step: number, min = 0) => {
  const n = Math.round((v - min) / step) * step + min
  const dp = Math.max(0, (String(step).split('.')[1] ?? '').length)
  return Number(n.toFixed(dp))
}
