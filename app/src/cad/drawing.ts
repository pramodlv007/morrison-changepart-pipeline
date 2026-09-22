/**
 * 2D dimensioned drawing as a self-contained SVG string (explicit colours, no CSS vars),
 * so the exact same file renders on screen, prints, and downloads.
 */
import { num, validateDesign, type Design } from '@/core/validate'
import { isImplemented } from '@/core/registry'
import { APP_NAME } from '@/core/app'

export interface Palette { bg: string; part: string; line: string; feature: string; bore: string; dim: string; center: string; text: string; muted: string }
export const PALETTES: Record<'studio' | 'portal', Palette> = {
  studio: { bg: '#0e1118', part: '#161b27', line: '#e8ebf2', feature: '#2dd4bf', bore: '#fb7185', dim: '#fbbf24', center: '#475069', text: '#e8ebf2', muted: '#8a93a8' },
  portal: { bg: '#ffffff', part: '#eef1f8', line: '#0e1330', feature: '#0891b2', bore: '#e11d48', dim: '#5046e5', center: '#b4bacb', text: '#0e1330', muted: '#6b7390' },
}

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const f1 = (x: number) => (Math.round(x * 10) / 10).toString()

export function drawingSvg(d: Design, label: string, theme: 'studio' | 'portal', audience: 'engineer' | 'customer'): string {
  const P = PALETTES[theme], W = 440, H = 440
  const dimH = (x1: number, x2: number, y: number, t: string, anchor: 'middle' | 'start' = 'middle') =>
    `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${P.dim}" stroke-width=".9" marker-start="url(#ar)" marker-end="url(#ar)"/>` +
    `<line x1="${x1}" y1="${y - 6}" x2="${x1}" y2="${y + 6}" stroke="${P.dim}" stroke-width=".6"/><line x1="${x2}" y1="${y - 6}" x2="${x2}" y2="${y + 6}" stroke="${P.dim}" stroke-width=".6"/>` +
    `<text x="${anchor === 'middle' ? (x1 + x2) / 2 : x1}" y="${y - 4}" text-anchor="${anchor}" fill="${P.dim}" class="l">${esc(t)}</text>`
  const dimV = (x: number, y1: number, y2: number, t: string, left: boolean) =>
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${P.dim}" stroke-width=".9" marker-start="url(#ar)" marker-end="url(#ar)"/>` +
    `<line x1="${x - 6}" y1="${y1}" x2="${x + 6}" y2="${y1}" stroke="${P.dim}" stroke-width=".6"/><line x1="${x - 6}" y1="${y2}" x2="${x + 6}" y2="${y2}" stroke="${P.dim}" stroke-width=".6"/>` +
    `<text x="${left ? x - 5 : x + 5}" y="${(y1 + y2) / 2 + 3}" text-anchor="${left ? 'end' : 'start'}" fill="${P.dim}" class="l">${esc(t)}</text>`
  const center = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${P.center}" stroke-width=".6" stroke-dasharray="10 3 2 3"/>`

  let body = '', view = ''
  if (!isImplemented(d.part_type)) {
    const rows = Object.entries(d).filter(([, v]) => typeof v === 'number').slice(0, 10)
      .map(([k, v], i) => `<text x="${W / 2}" y="${170 + i * 18}" text-anchor="middle" fill="${P.muted}" class="l">${esc(k.replace(/_/g, ' '))}: ${v}</text>`).join('')
    body = `<text x="${W / 2}" y="140" text-anchor="middle" fill="${P.dim}" class="l">No drawing template for ${esc(label)} yet</text>${rows}`
  } else if (d.part_type === 'starwheel') {
    const pcd = num(d.pcd_mm, 620), n = Math.max(1, Math.round(num(d.pocket_count, 16))), r = num(d.pocket_radius_mm, 32.8)
    const rim = num(d.rim_mm, 8), bore = num(d.bore_diameter_mm, 50), OD = pcd + 2 * r + 2 * rim, s = 270 / OD, cx = W / 2, cy = 200
    body += `<circle cx="${cx}" cy="${cy}" r="${OD / 2 * s}" fill="${P.part}" stroke="${P.line}" stroke-width="1.3"/>`
    body += `<circle cx="${cx}" cy="${cy}" r="${pcd / 2 * s}" fill="none" stroke="${P.feature}" stroke-width=".6" stroke-dasharray="4 3"/>`
    for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; body += `<circle cx="${cx + pcd / 2 * s * Math.cos(a)}" cy="${cy + pcd / 2 * s * Math.sin(a)}" r="${r * s}" fill="${P.bg}" stroke="${P.feature}" stroke-width="1"/>` }
    body += `<circle cx="${cx}" cy="${cy}" r="${bore / 2 * s}" fill="${P.bg}" stroke="${P.bore}" stroke-width="1"/>`
    body += center(cx - OD / 2 * s - 10, cy, cx + OD / 2 * s + 10, cy) + center(cx, cy - OD / 2 * s - 10, cx, cy + OD / 2 * s + 10)
    body += dimH(cx - OD / 2 * s, cx + OD / 2 * s, cy + OD / 2 * s + 24, `⌀${f1(OD)} OD`)
    body += dimH(cx - pcd / 2 * s, cx + pcd / 2 * s, cy - OD / 2 * s - 14, `PCD ${pcd}`)
    body += `<text x="${cx + pcd / 2 * s + r * s + 5}" y="${cy - r * s - 3}" fill="${P.feature}" class="l">${n}× ⌀${f1(2 * r)} THRU</text>`
    body += `<text x="${cx + bore / 2 * s + 5}" y="${cy + 14}" fill="${P.bore}" class="l">BORE ⌀${bore}</text>`
    view = `TOP VIEW · t = ${num(d.wheel_thickness_mm, 20)} mm`
  } else if (d.part_type === 'feed_screw') {
    const len = num(d.length_mm, 480), od = num(d.outer_diameter_mm, 140), root = num(d.root_diameter_mm, 90), pitch = Math.max(1, num(d.pitch_mm, 80))
    const ft = num(d.flight_thickness_mm, 10), starts = Math.max(1, Math.round(num(d.starts, 1)))
    const s = Math.min(290 / len, 160 / od), cx = W / 2, cy = 190, L = len * s, x0 = cx - L / 2, depth = (od - root) / 2 * s
    body += `<rect x="${x0}" y="${cy - root / 2 * s}" width="${L}" height="${root * s}" fill="${P.part}" stroke="${P.line}" stroke-width="1"/>`
    const nT = Math.floor(len / pitch) * starts
    for (let k = 0; k < nT; k++) {
      const fx = x0 + (k * pitch / starts) * s
      if (fx + ft * s > x0 + L) break
      body += `<rect x="${fx}" y="${cy - od / 2 * s}" width="${ft * s}" height="${depth}" fill="${P.feature}" fill-opacity=".35" stroke="${P.feature}" stroke-width=".7"/>`
      if (fx + (pitch / 2 + ft) * s <= x0 + L) body += `<rect x="${fx + (pitch / 2) * s}" y="${cy + root / 2 * s}" width="${ft * s}" height="${depth}" fill="${P.feature}" fill-opacity=".35" stroke="${P.feature}" stroke-width=".7"/>`
    }
    body += center(x0 - 12, cy, x0 + L + 12, cy)
    body += dimH(x0, x0 + L, cy + od / 2 * s + 28, `L ${len}`)
    body += dimH(x0, x0 + pitch * s, cy - od / 2 * s - 14, `PITCH ${pitch}${starts > 1 ? ` · ${starts}-START · LEAD ${pitch * starts}` : ''}`, 'start')
    body += dimV(x0 + L + 18, cy - od / 2 * s, cy + od / 2 * s, `⌀${od} OD`, false)
    body += dimV(x0 - 18, cy - root / 2 * s, cy + root / 2 * s, `⌀${root} ROOT`, true)
    view = `SIDE ELEVATION · ${esc(d.handedness ?? 'RH')} · flight t = ${ft} mm`
  } else {
    const R = num(d.rail_radius_mm, 340), t = num(d.thickness_mm, 12), arcDeg = num(d.arc_angle_deg, 120), arc = arcDeg * Math.PI / 180
    const pcd = num(d.mating_pcd_mm, 620), bd = num(d.bottle_diameter_mm, 54)
    const s = 180 / (R + t), cx = W / 2, cy = 270, a0 = -Math.PI / 2 - arc / 2, a1 = -Math.PI / 2 + arc / 2
    const pt = (r: number, a: number) => [cx + r * s * Math.cos(a), cy + r * s * Math.sin(a)]
    const [p1, p2, p3, p4] = [pt(R, a0), pt(R, a1), pt(R + t, a1), pt(R + t, a0)], big = arc > Math.PI ? 1 : 0
    body += `<path d="M${p1} A${R * s},${R * s} 0 ${big} 1 ${p2} L${p3} A${(R + t) * s},${(R + t) * s} 0 ${big} 0 ${p4} Z" fill="${P.part}" stroke="${P.line}" stroke-width="1.3"/>`
    body += `<circle cx="${cx}" cy="${cy}" r="${pcd / 2 * s}" fill="none" stroke="${P.feature}" stroke-width=".6" stroke-dasharray="4 3"/>`
    const N = Math.max(1, Math.round(Math.PI * pcd / (2.2 * bd))), nArc = Math.max(1, Math.round(arc / (2 * Math.PI) * N))
    for (let i = 0; i < nArc; i++) { const a = -Math.PI / 2 + (i - (nArc - 1) / 2) * (2 * Math.PI / N), q = pt(pcd / 2, a); body += `<circle cx="${q[0]}" cy="${q[1]}" r="${bd / 2 * s}" fill="none" stroke="${P.muted}" stroke-width=".6" stroke-dasharray="2 2"/>` }
    const rm = pt(R, -Math.PI / 2)
    body += `<line x1="${cx}" y1="${cy}" x2="${rm[0]}" y2="${rm[1]}" stroke="${P.dim}" stroke-width=".9" marker-end="url(#ar)"/><text x="${cx + 6}" y="${cy - R * 0.8 * s}" fill="${P.dim}" class="l">R${R} inner</text>`
    const q0 = pt(R * 0.42, a0), q1 = pt(R * 0.42, a1)
    body += `<path d="M${q0} A${R * 0.42 * s},${R * 0.42 * s} 0 ${big} 1 ${q1}" fill="none" stroke="${P.dim}" stroke-width=".7" marker-start="url(#ar)" marker-end="url(#ar)"/><text x="${cx}" y="${cy - R * 0.42 * s + 14}" text-anchor="middle" fill="${P.dim}" class="l">${arcDeg}°</text>`
    body += `<text x="${p3[0] + 5}" y="${p3[1]}" fill="${P.dim}" class="l">t = ${t}</text>`
    body += center(cx - 10, cy, cx + 10, cy) + center(cx, cy - 10, cx, cy + 10)
    body += `<text x="${cx}" y="${cy + 20}" text-anchor="middle" fill="${P.muted}" class="s">MATING STARWHEEL PCD ${pcd} · CONTAINER ⌀${bd}</text>`
    view = `PLAN VIEW · h = ${num(d.rail_height_mm, 25)} mm · contact @ ${num(d.contact_height_mm, 95)} mm`
  }

  const card = validateDesign(d, label)
  const l2 = audience === 'customer'
    ? `${esc(d.material_id ?? '')} · for your ${esc(d.machine_id ?? '')} at ${esc(d.target_speed_cpm ?? '')} containers/min`
    : `MATERIAL ${esc(d.material_id ?? '')} · MACHINE ${esc(d.machine_id ?? '')} · ${esc(d.target_speed_cpm ?? '')} CPM · STAGE 5 ${card.verdict.toUpperCase()}`
  const l3 = audience === 'customer' ? `${esc(APP_NAME)} · dimensions in mm, shown for approval` : `${esc(APP_NAME)} · engineering view`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" font-family="Inter, system-ui, sans-serif">
<style>.l{font-size:9.5px;font-weight:600;letter-spacing:.02em}.s{font-size:8px}</style>
<defs><marker id="ar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${P.dim}"/></marker></defs>
<rect width="${W}" height="${H}" fill="${P.bg}"/>${body}
<rect x="8" y="${H - 50}" width="${W - 16}" height="42" rx="4" fill="none" stroke="${P.center}" stroke-width=".7"/>
<text x="16" y="${H - 34}" fill="${P.text}" class="l">${esc(label.toUpperCase())}${view ? ' — ' + view : ''}</text>
<text x="16" y="${H - 22}" fill="${P.muted}" class="s">${l2}</text>
<text x="16" y="${H - 12}" fill="${P.muted}" class="s">${l3}</text></svg>`
}

export function downloadText(name: string, text: string, type = 'image/svg+xml') {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name })
  document.body.appendChild(a); a.click(); a.remove()
}
