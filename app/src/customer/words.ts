/** Plain-language vocabulary for the portal. Customers never see field keys or engineering shorthand. */
import type { PartType } from '@/core/registry'

export const FIELD_WORDS: Record<string, { label: string; unit?: string; help?: string }> = {
  machine_id: { label: 'Your machine' },
  target_speed_cpm: { label: 'Line speed', unit: 'containers / min', help: 'How many containers the line runs per minute at full speed.' },
  bottle_diameter_mm: { label: 'Container diameter', unit: 'mm', help: 'Measured across the widest point of the body.' },
  bottle_height_mm: { label: 'Container height', unit: 'mm' },
  material_id: { label: 'Material' },
  handedness: { label: 'Rotation' },
  starts: { label: 'Number of flights' },
}

export const MATERIAL_SWATCH: Record<string, { color: string; ring: string }> = {
  'UHMW-PE': { color: '#eef2f8', ring: '#c7d2fe' },
  POM: { color: '#dde4ee', ring: '#a5b4fc' },
  PTFE: { color: '#f7f8fa', ring: '#e0e7ff' },
  PEEK: { color: '#d6b97c', ring: '#f59e0b' },
}

export function dimLabel(part: PartType | undefined, k: string): string {
  const d = part?.customerDims.find(x => x.k === k)
  if (d) return d.l
  const c = part?.customerControls.find(x => x.k === k)
  if (c) return c.l
  const s = part?.sliders.find(x => x.k === k)
  if (s) return s.l.replace(/\s*\(.*?\)\s*$/, '')
  return FIELD_WORDS[k]?.label ?? k.replace(/_mm$|_deg$/, '').replace(/_/g, ' ')
}

export function fmtValue(k: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (k === 'handedness') return String(v).toUpperCase().startsWith('L') ? 'Left-hand' : 'Right-hand'
  if (typeof v === 'number') {
    const n = Math.round(v * 100) / 100
    if (k.endsWith('_deg')) return `${n}°`
    if (k.endsWith('_mm')) return `${n} mm`
    if (k === 'target_speed_cpm') return `${n} / min`
    return String(n)
  }
  return String(v)
}
