/**
 * Validation feedback loop. When Stage 5 rejects, the failure is routed by cause and
 * the deterministic engine hands the model the corrective RANGE — a small model told
 * only the threshold walks the value the wrong way and never converges.
 */
import { CONTAINER, DEFAULT_OVALITY, FOOD_SAFE_MATERIALS, LIMITS, MACHINES } from './standards'
import { num, type Design, type Scorecard } from './validate'

export type Route = 'stage3' | 'stage1' | 'none'
const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100

/** Spec-level conflicts (material, machine rating) need the customer; geometry the designer can change. */
export function classifyFailure(card: Scorecard): { route: Route; failing: string[] } {
  const failing = card.checks.filter(c => !c.pass).map(c => c.id)
  if (card.verdict === 'unvalidated') return { route: 'none', failing }
  if (card.verdict === 'accept') return { route: 'none', failing }
  const specLevel = card.checks.some(c => !c.pass && (c.id === 'food' || c.id === 'speed' || /not in the catalog|no screw-drive data|no torque rating/.test(c.reason)))
  return { route: specLevel ? 'stage1' : 'stage3', failing }
}

export function repairHints(card: Scorecard, d: Design): string[] {
  const h: string[] = []
  const failed = (id: string) => card.checks.some(c => c.id === id && !c.pass)
  const ov = num(d.ovality_mm, DEFAULT_OVALITY), bd = num(d.bottle_diameter_mm, 54), floor = LIMITS.minEffectiveClearanceMm

  if (card.type === 'starwheel') {
    if (failed('clearance')) {
      const min = floor + ov / 2
      h.push(`pocket_clearance_mm must be MORE than ${r2(min)} (c_eff = pocket_clearance_mm − ovality/2 = pocket_clearance_mm − ${ov}/2 must exceed ${floor}). It is currently ${d.pocket_clearance_mm} — INCREASE it, e.g. to ${r2(min + 0.3)}.`)
    }
    if (failed('web') || failed('geometry')) {
      const maxR = (num(d.pcd_mm, 620) * Math.sin(Math.PI / num(d.pocket_count, 16)) - LIMITS.minWebMm) / 2
      h.push(`pocket_radius_mm must be AT MOST ${r2(maxR)} (web = PCD × sin(π/N) − 2r must be ≥ ${LIMITS.minWebMm}). It is currently ${d.pocket_radius_mm} — DECREASE it.`)
    }
  }
  if (card.type === 'feed_screw') {
    const S = LIMITS.screw, ft = num(d.flight_thickness_mm, 10)
    if (failed('clearance')) {
      const minPitch = bd + ft + floor + ov / 2
      h.push(`pitch_mm must be MORE than ${r2(minPitch)} (pocket = pitch − flight; pocket − ⌀ − ovality/2 must exceed ${floor}). It is currently ${d.pitch_mm} — INCREASE it, e.g. to ${r2(minPitch + 3)}.`)
    }
    if (failed('maxClearance')) h.push(`pitch_mm must be AT MOST ${r2(bd + ft + S.maxClearanceMm)} — DECREASE it (currently ${d.pitch_mm}).`)
    if (failed('rpm')) {
      const m = MACHINES[String(d.machine_id)]
      const need = m?.screwMaxRpm ? Math.ceil(num(d.target_speed_cpm, 380) / m.screwMaxRpm) : 2
      h.push(`starts must be AT LEAST ${need} (screw rpm = target_speed_cpm / starts must be ≤ ${m?.screwMaxRpm ?? 'the drive limit'}). It is currently ${d.starts} — INCREASE it.`)
    }
    if (failed('engagement')) {
      const minOD = num(d.root_diameter_mm, 90) + 2 * S.minEngagement * bd
      h.push(`outer_diameter_mm must be AT LEAST ${r2(minOD)} (flight depth (OD − root)/2 must be ≥ ${S.minEngagement * 100}% of the ${bd} mm container). It is currently ${d.outer_diameter_mm} — INCREASE it.`)
    }
    if (failed('bottles')) h.push(`length_mm must be AT LEAST ${r2(S.minBottles * num(d.pitch_mm, 80))} (floor(length / pitch) must be ≥ ${S.minBottles}). It is currently ${d.length_mm} — INCREASE it.`)
    if (failed('flight')) h.push(`flight_thickness_mm must be AT LEAST ${S.minFlightMm} — INCREASE it (currently ${ft}).`)
  }
  if (card.type === 'guide_rail') {
    const R = LIMITS.rail, base = num(d.mating_pcd_mm, 620) / 2 + bd / 2
    if (failed('clearance') || failed('geometry')) h.push(`rail_radius_mm must be MORE than ${r2(base + floor + ov / 2)} (gap = rail_radius_mm − ${r2(base)}; gap − ovality/2 must exceed ${floor}). It is currently ${d.rail_radius_mm} — INCREASE it.`)
    if (failed('maxGap')) h.push(`rail_radius_mm must be AT MOST ${r2(base + R.maxGapMm)} — DECREASE it (currently ${d.rail_radius_mm}).`)
    if (failed('arc')) h.push(`arc_angle_deg must be between ${R.minArcDeg} and ${R.maxArcDeg} — currently ${d.arc_angle_deg}.`)
    if (failed('contact')) {
      const bh = num(d.bottle_height_mm, CONTAINER.heightMm)
      h.push(`contact_height_mm must be between ${r1(R.contactBand[0] * bh)} and ${r1(R.contactBand[1] * bh)} for a ${bh} mm container — currently ${d.contact_height_mm}.`)
    }
    if (failed('thickness')) h.push(`thickness_mm must be AT LEAST ${R.minThicknessMm} — currently ${d.thickness_mm}.`)
    if (failed('height')) h.push(`rail_height_mm must be AT LEAST ${R.minHeightMm} — currently ${d.rail_height_mm}.`)
  }
  return h
}

export function feedbackPacket(card: Scorecard, d: Design, iteration: number, partLabel: string): string {
  const lines = card.checks.filter(c => !c.pass).map(c => `- ${c.label}: ${c.reason}${c.cite ? ` [${c.cite}]` : ''}`)
  const m = MACHINES[String(d.machine_id)]
  const limits = [
    `effective clearance / running gap after container ovality must be > ${LIMITS.minEffectiveClearanceMm} mm`,
    m ? `${m.id} rated max ${m.maxCpm} CPM` : null,
    m?.screwMaxRpm ? `${m.id} infeed screw drive max ${m.screwMaxRpm} rpm and ${m.screwTorqueNm} N·m` : null,
    `approved food-contact materials: ${FOOD_SAFE_MATERIALS.join(', ')}`,
  ].filter(Boolean)
  const rejected = Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v !== 'object'))
  const hints = repairHints(card, d)
  return `VALIDATION FEEDBACK - attempt ${iteration} was REJECTED by the deterministic Stage 5 gate for this ${partLabel}:\n${lines.join('\n')}\n`
    + `Rejected values: ${JSON.stringify(rejected)}\n`
    + (hints.length ? `REQUIRED CORRECTIONS (computed exactly - follow these literally):\n${hints.map(x => '- ' + x).join('\n')}\n` : '')
    + `Hard limits: ${limits.join('; ')}.\n`
    + 'Propose branches that satisfy EVERY required correction above without breaking another check. Do not repeat the rejected values, and do not move a value in the opposite direction to the one stated.'
}
