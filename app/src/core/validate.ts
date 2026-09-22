/**
 * Stage 5 — the deterministic safety gate. Browser mirror of stage5_engine.py.
 * No model is involved, by design: a ±0.15 mm estimate is a jam at 380 CPM.
 * Every verdict shown anywhere in the UI must come from here (or the Python engine).
 */
import { CONTAINER, DEFAULT_OVALITY, LIMITS, MACHINES, MATERIALS, type Machine } from './standards'
import { isImplemented } from './registry'

export type Design = { part_type: string; [k: string]: any }
export type Verdict = 'accept' | 'reject' | 'unvalidated'

export interface Check {
  id: string
  label: string        // engineering wording
  plain: string        // what it means to a customer
  pass: boolean
  reason: string       // engineering diagnosis when failing
  plainReason: string  // customer wording when failing
  cite: string
}
export interface Formula { label: string; expr: string; result: string; limit: string; ok: boolean }
export interface Tile { label: string; value: number | null; unit: string; ok: boolean; fraction: number }
export interface Scorecard {
  type: string
  verdict: Verdict
  checks: Check[]
  computed: Record<string, number | null>
  score: number
  reasons: string[]
  formulas: Formula[]
  tiles: Tile[]
}

export const num = (v: unknown, fallback: number): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(x) ? x : fallback
}
const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

function check(id: string, label: string, plain: string, pass: boolean, reason: string, plainReason: string, cite = ''): Check {
  return { id, label, plain, pass, reason: pass ? '' : reason, plainReason: pass ? '' : plainReason, cite: pass ? '' : cite }
}

function speedCheck(util: number | null, cpm: number, m: Machine | undefined, mid: string): Check {
  return check('speed', 'Speed within machine rating', 'Runs at your target line speed',
    util !== null && util <= 1,
    util === null ? `Machine '${mid}' is not in the catalog.` : `Speed ${cpm} CPM exceeds rated max ${m!.maxCpm} CPM (utilisation ${util.toFixed(3)}).`,
    util === null ? 'We have no data on file for that machine.' : 'That line speed is above this machine’s rated maximum.',
    m?.source ?? '')
}

function foodCheck(mat: string): Check {
  const m = MATERIALS[mat]
  if (!m) {
    return check('food', 'Food-contact compliant', 'Material is approved for food and beverage contact', false,
      `Material '${mat}' is unregistered — fails closed pending engineering review.`,
      'We have no food-contact approval on file for that material.', '21 CFR § 174.5')
  }
  return check('food', 'Food-contact compliant', 'Material is approved for food and beverage contact', m.compliant,
    `Material '${mat}' is not food-contact approved.`, 'That material is not approved for food and beverage contact.', m.citation)
}

function finish(type: string, checks: Check[], computed: Record<string, number | null>, score: number, formulas: Formula[], tiles: Tile[]): Scorecard {
  const verdict: Verdict = checks.every(c => c.pass) ? 'accept' : 'reject'
  return { type, verdict, checks, computed, score: verdict === 'accept' ? score : 0,
    reasons: checks.filter(c => !c.pass).map(c => c.reason), formulas, tiles }
}

/* ---------------- starwheel ---------------- */
function starwheel(d: Design): Scorecard {
  const pcd = num(d.pcd_mm, 620), n = Math.max(1, Math.round(num(d.pocket_count, 16))), r = num(d.pocket_radius_mm, 32.8)
  const clr = num(d.pocket_clearance_mm, 0.8), ov = num(d.ovality_mm, DEFAULT_OVALITY), cpm = num(d.target_speed_cpm, 380)
  const mid = String(d.machine_id ?? ''), mass = num(d.filled_mass_kg, CONTAINER.massKg)
  const floor = LIMITS.minEffectiveClearanceMm, minWeb = LIMITS.minWebMm
  const web = pcd * Math.sin(Math.PI / n) - 2 * r
  const ec = clr - ov / 2
  const m = MACHINES[mid]
  const util = m ? cpm / m.maxCpm : null
  const rpm = cpm / n, omega = 2 * Math.PI * rpm / 60
  const pocketLoad = mass * omega * omega * (pcd / 2000)
  const overlap = `Web ${web.toFixed(2)} mm is negative — pocket cutouts overlap.`

  const checks = [
    check('geometry', 'Geometry valid (web > 0)', 'The shape is physically buildable', web > 0, overlap, 'The pockets would overlap each other.'),
    check('web', `Web thickness ≥ ${minWeb} mm`, 'Enough material between pockets so it will not flex or crack', web >= minWeb,
      web <= 0 ? overlap : `Web ${web.toFixed(2)} mm is below the ${minWeb} mm structural minimum.`,
      'Too little material between pockets — it could crack.', LIMITS.webSource),
    check('clearance', `Effective clearance > ${floor} mm`, 'Your containers fit the pockets without binding, even at their widest', ec > floor,
      `Effective clearance ${ec.toFixed(3)} mm is at or below the ${floor} mm floor — the container binds.`,
      'The containers would be gripped too tightly and could jam.', LIMITS.clearanceSource),
    speedCheck(util, cpm, m, mid),
    foodCheck(String(d.material_id ?? '')),
  ]
  const score = 0.6 + 0.3 * clamp01((ec - floor) / 0.5) + 0.1 * (util !== null ? Math.max(0, 1 - util) : 0)
  return finish('starwheel', checks,
    { web: r2(web), effectiveClearance: r3(ec), utilisation: util !== null ? r3(util) : null, rpm: r1(rpm), pocketLoadN: r2(pocketLoad) },
    r2(score),
    [
      { label: 'Web between pockets', expr: `PCD × sin(π/N) − 2r = ${pcd} × sin(π/${n}) − 2 × ${r}`, result: `${r2(web)} mm`, limit: `≥ ${minWeb} mm`, ok: web >= minWeb },
      { label: 'Effective clearance', expr: `clearance − ovality/2 = ${clr} − ${ov}/2`, result: `${r3(ec)} mm`, limit: `> ${floor} mm`, ok: ec > floor },
      { label: 'Speed utilisation', expr: `target / rated = ${cpm} / ${m?.maxCpm ?? '?'}`, result: util !== null ? util.toFixed(3) : 'n/a', limit: '≤ 1.000', ok: util !== null && util <= 1 },
      { label: 'Pocket load (info)', expr: `m × ω² × PCD/2 at ${r1(rpm)} rpm`, result: `${r2(pocketLoad)} N`, limit: '—', ok: true },
    ],
    [
      { label: 'Web thickness', value: r2(web), unit: 'mm', ok: web >= minWeb, fraction: web / 80 },
      { label: 'Effective clearance', value: r3(ec), unit: 'mm', ok: ec > floor, fraction: ec / 2 },
      { label: 'Speed utilisation', value: util !== null ? r3(util) : null, unit: '', ok: util !== null && util <= 1, fraction: util ?? 0 },
    ])
}

/* ---------------- feed screw ---------------- */
function feedScrew(d: Design): Scorecard {
  const S = LIMITS.screw, floor = LIMITS.minEffectiveClearanceMm
  const pitch = num(d.pitch_mm, 80), od = num(d.outer_diameter_mm, 140), root = num(d.root_diameter_mm, 90)
  const len = num(d.length_mm, 480), starts = Math.max(1, Math.round(num(d.starts, 1))), ft = num(d.flight_thickness_mm, 10)
  const bd = num(d.bottle_diameter_mm, 66), ov = num(d.ovality_mm, DEFAULT_OVALITY), cpm = num(d.target_speed_cpm, 380)
  const mid = String(d.machine_id ?? ''), mass = num(d.filled_mass_kg, CONTAINER.massKg)
  const mu = num(d.friction_coefficient, CONTAINER.mu), bp = num(d.accumulation_backpressure_n, CONTAINER.backpressureN)

  const pocketW = pitch - ft, clr = pocketW - bd, ec = clr - ov / 2
  const depth = (od - root) / 2, engage = bd > 0 ? depth / bd : 0
  const nEng = pitch > 0 ? Math.floor(len / pitch) : 0
  const rpm = cpm / starts
  const torque = S.dynamicFactor * (nEng * mu * mass * 9.81 + bp) * (od / 2 / 1000)
  const m = MACHINES[mid], util = m ? cpm / m.maxCpm : null
  const maxRpm = m?.screwMaxRpm ?? null, maxT = m?.screwTorqueNm ?? null

  const checks = [
    check('geometry', 'Geometry valid (root < OD, pocket > 0)', 'The shape is physically buildable', root < od && pocketW > 0 && len > 0,
      'Root must be smaller than the OD and the pocket (pitch − flight) must be positive.', 'The screw proportions are not buildable.'),
    check('clearance', `Effective pocket clearance > ${floor} mm`, 'Your containers fit between the flights without binding', ec > floor,
      `Effective clearance ${ec.toFixed(2)} mm is at or below the ${floor} mm floor — the container binds between flights.`,
      'The containers would be gripped too tightly and could jam.', LIMITS.clearanceSource),
    check('maxClearance', `Pocket clearance ≤ ${S.maxClearanceMm} mm`, 'Containers are held snugly enough to stay in time', clr <= S.maxClearanceMm,
      `Clearance ${clr.toFixed(2)} mm exceeds ${S.maxClearanceMm} mm — the container rattles and mis-times into the starwheel.`,
      'Containers would sit too loosely and lose their spacing.', S.source),
    check('engagement', `Flight engagement ≥ ${S.minEngagement * 100}% of container ⌀`, 'The screw grips enough of each container to control it',
      engage >= S.minEngagement, `The flight engages only ${(engage * 100).toFixed(0)}% of the container diameter.`,
      'It would not grip enough of each container to control it.', S.source),
    check('flight', `Flight thickness ≥ ${S.minFlightMm} mm`, 'The screw flight is thick enough to last in service', ft >= S.minFlightMm,
      `Flight ${ft} mm is below the ${S.minFlightMm} mm minimum.`, 'The flight would be too thin to last.', S.source),
    check('bottles', `Containers engaged ≥ ${S.minBottles}`, 'Enough containers are controlled at once for steady timing', nEng >= S.minBottles,
      `Only ${nEng} containers engaged (length ÷ pitch); at least ${S.minBottles} are needed for stable timing.`,
      'Too short to control enough containers for steady timing.', S.source),
    check('rpm', 'Screw speed within drive limit', 'The screw turns within your machine drive’s speed limit', maxRpm !== null && rpm <= maxRpm,
      maxRpm === null ? `Machine '${mid}' has no screw-drive data.` : `Screw ${rpm.toFixed(0)} rpm (${cpm} CPM ÷ ${starts} start${starts > 1 ? 's' : ''}) exceeds the ${maxRpm} rpm drive limit.`,
      'It would have to turn faster than your machine drive allows.', m?.source ?? ''),
    check('torque', 'Drive torque within rating', 'Your machine drive has enough torque to turn it', maxT !== null && torque <= maxT,
      maxT === null ? `Machine '${mid}' has no torque rating.` : `Estimated drive torque ${torque.toFixed(2)} N·m exceeds the rated ${maxT} N·m.`,
      'Your machine drive would not have enough torque to turn it.', m?.source ?? ''),
    speedCheck(util, cpm, m, mid),
    foodCheck(String(d.material_id ?? '')),
  ]
  const score = 0.6 + 0.25 * clamp01((ec - floor) / 2) + 0.15 * (maxT ? Math.max(0, 1 - torque / maxT) : 0)
  return finish('feed_screw', checks,
    { pocketWidth: r2(pocketW), clearance: r2(clr), effectiveClearance: r2(ec), flightDepth: r2(depth), engagement: r3(engage),
      containersEngaged: nEng, rpm: r1(rpm), torqueNm: r2(torque), maxTorqueNm: maxT, maxRpm, utilisation: util !== null ? r3(util) : null },
    r2(score),
    [
      { label: 'Pocket width', expr: `pitch − flight = ${pitch} − ${ft}`, result: `${r2(pocketW)} mm`, limit: '> 0', ok: pocketW > 0 },
      { label: 'Effective clearance', expr: `(pocket − ⌀) − ovality/2 = (${r2(pocketW)} − ${bd}) − ${ov}/2`, result: `${r2(ec)} mm`, limit: `> ${floor}, ≤ ${S.maxClearanceMm} mm`, ok: ec > floor && clr <= S.maxClearanceMm },
      { label: 'Flight engagement', expr: `(OD − root)/2 ÷ ⌀ = ${r2(depth)} / ${bd}`, result: `${(engage * 100).toFixed(0)}%`, limit: `≥ ${S.minEngagement * 100}%`, ok: engage >= S.minEngagement },
      { label: 'Containers engaged', expr: `floor(length / pitch) = floor(${len} / ${pitch})`, result: String(nEng), limit: `≥ ${S.minBottles}`, ok: nEng >= S.minBottles },
      { label: 'Screw speed', expr: `target / starts = ${cpm} / ${starts}`, result: `${r1(rpm)} rpm`, limit: `≤ ${maxRpm ?? '?'} rpm`, ok: maxRpm !== null && rpm <= maxRpm },
      { label: 'Drive torque', expr: `${S.dynamicFactor} × (n·μ·m·g + backpressure) × OD/2`, result: `${r2(torque)} N·m`, limit: `≤ ${maxT ?? '?'} N·m`, ok: maxT !== null && torque <= maxT },
    ],
    [
      { label: 'Effective clearance', value: r2(ec), unit: 'mm', ok: ec > floor && clr <= S.maxClearanceMm, fraction: ec / 3 },
      { label: 'Drive torque', value: r2(torque), unit: maxT ? `N·m / ${maxT}` : 'N·m', ok: maxT !== null && torque <= maxT, fraction: maxT ? torque / maxT : 0 },
      { label: 'Screw speed', value: r1(rpm), unit: maxRpm ? `rpm / ${maxRpm}` : 'rpm', ok: maxRpm !== null && rpm <= maxRpm, fraction: maxRpm ? rpm / maxRpm : 0 },
    ])
}

/* ---------------- guide rail ---------------- */
function guideRail(d: Design): Scorecard {
  const R = LIMITS.rail, floor = LIMITS.minEffectiveClearanceMm
  const rad = num(d.rail_radius_mm, 340), arc = num(d.arc_angle_deg, 120), h = num(d.rail_height_mm, 25), t = num(d.thickness_mm, 12)
  const ch = num(d.contact_height_mm, 95), pcd = num(d.mating_pcd_mm, 620), bd = num(d.bottle_diameter_mm, 54)
  const bh = num(d.bottle_height_mm, CONTAINER.heightMm), ov = num(d.ovality_mm, DEFAULT_OVALITY), cpm = num(d.target_speed_cpm, 380)
  const mid = String(d.machine_id ?? ''), mat = String(d.material_id ?? ''), mass = num(d.filled_mass_kg, CONTAINER.massKg)

  const gap = rad - pcd / 2 - bd / 2, eg = gap - ov / 2
  const band: [number, number] = [R.contactBand[0] * bh, R.contactBand[1] * bh]
  const N = d.mating_pocket_count ? Math.max(1, Math.round(num(d.mating_pocket_count, 16))) : Math.max(1, Math.round(Math.PI * pcd / (2.2 * bd)))
  const nArc = Math.max(1, Math.round(arc / 360 * N))
  const omega = 2 * Math.PI * (cpm / N) / 60
  const load = nArc * mass * omega * omega * (pcd / 2000)
  const allow = MATERIALS[mat]?.allowableLoadN ?? null
  const m = MACHINES[mid], util = m ? cpm / m.maxCpm : null

  const checks = [
    check('geometry', 'Geometry valid (gap > 0)', 'The shape is physically buildable', gap > 0 && t > 0 && h > 0,
      `Running gap ${gap.toFixed(2)} mm is not positive — the rail sits inside the container envelope.`, 'The rail would collide with the containers.'),
    check('clearance', `Effective running gap > ${floor} mm`, 'Containers pass the rail without binding', eg > floor,
      `Effective gap ${eg.toFixed(2)} mm is at or below the ${floor} mm floor — the container binds between pocket and rail.`,
      'The rail would sit too close and could pinch the containers.', LIMITS.clearanceSource),
    check('maxGap', `Running gap ≤ ${R.maxGapMm} mm`, 'Containers stay seated and cannot tip out', gap <= R.maxGapMm,
      `Gap ${gap.toFixed(2)} mm exceeds ${R.maxGapMm} mm — containers can tip out of the pocket.`,
      'The rail would sit too far away — containers could tip out.', R.source),
    check('arc', `Arc ${R.minArcDeg}–${R.maxArcDeg}°`, 'The wrap still allows access for changeovers', arc >= R.minArcDeg && arc <= R.maxArcDeg,
      `Arc ${arc}° is outside ${R.minArcDeg}–${R.maxArcDeg}° — past 180° the rail traps containers and blocks changeover access.`,
      'It would wrap too far around and block changeover access.', R.source),
    check('contact', 'Contact height on the container body', 'The rail touches the straight body, not the shoulder or base', ch >= band[0] && ch <= band[1],
      `Contact height ${ch} mm is outside the body band ${band[0].toFixed(0)}–${band[1].toFixed(0)} mm.`,
      'It would touch the container’s shoulder or base instead of its body.', R.source),
    check('thickness', `Rail thickness ≥ ${R.minThicknessMm} mm`, 'The rail is thick enough to stay rigid', t >= R.minThicknessMm,
      `Thickness ${t} mm is below the ${R.minThicknessMm} mm minimum.`, 'The rail would be too thin to stay rigid.', R.source),
    check('height', `Rail height ≥ ${R.minHeightMm} mm`, 'The rail is tall enough to guide the container', h >= R.minHeightMm,
      `Height ${h} mm is below the ${R.minHeightMm} mm minimum.`, 'The rail would be too short to guide the container.', R.source),
    check('load', 'Radial load within material allowable', 'The material can take the load at your line speed', allow !== null && load <= allow,
      allow === null ? `Material '${mat}' has no allowable contact load on file (fails closed).` : `Radial load ${load.toFixed(1)} N exceeds the allowable ${allow} N.`,
      'The material could not take the load at your line speed.'),
    speedCheck(util, cpm, m, mid),
    foodCheck(mat),
  ]
  const score = 0.6 + 0.25 * clamp01((eg - floor) / 2) + 0.15 * (allow ? Math.max(0, 1 - load / allow) : 0)
  return finish('guide_rail', checks,
    { gap: r2(gap), effectiveGap: r2(eg), bandLow: r1(band[0]), bandHigh: r1(band[1]), matingPockets: N, containersInArc: nArc,
      radialLoadN: r2(load), allowableLoadN: allow, utilisation: util !== null ? r3(util) : null },
    r2(score),
    [
      { label: 'Running gap', expr: `R − PCD/2 − ⌀/2 = ${rad} − ${pcd}/2 − ${bd}/2`, result: `${r2(gap)} mm`, limit: `≤ ${R.maxGapMm} mm`, ok: gap > 0 && gap <= R.maxGapMm },
      { label: 'Effective gap', expr: `gap − ovality/2 = ${r2(gap)} − ${ov}/2`, result: `${r2(eg)} mm`, limit: `> ${floor} mm`, ok: eg > floor },
      { label: 'Contact band', expr: `[${R.contactBand[0]}, ${R.contactBand[1]}] × H = ${bh} mm`, result: `${r1(band[0])}–${r1(band[1])} mm`, limit: `contact ${ch} mm`, ok: ch >= band[0] && ch <= band[1] },
      { label: 'Radial load', expr: `n_arc × m × ω² × PCD/2, n_arc = ${nArc} of ${N}`, result: `${r2(load)} N`, limit: `≤ ${allow ?? '?'} N`, ok: allow !== null && load <= allow },
    ],
    [
      { label: 'Effective gap', value: r2(eg), unit: 'mm', ok: eg > floor && gap <= R.maxGapMm, fraction: eg / 3 },
      { label: 'Radial load', value: r2(load), unit: allow ? `N / ${allow}` : 'N', ok: allow !== null && load <= allow, fraction: allow ? load / allow : 0 },
      { label: 'Speed utilisation', value: util !== null ? r3(util) : null, unit: '', ok: util !== null && util <= 1, fraction: util ?? 0 },
    ])
}

/* ---------------- dispatch ---------------- */
function unvalidated(type: string, label: string): Scorecard {
  const reason = `No Stage 5 physics is implemented for "${label}", so this design has NOT been checked. Add validate_${type}() to stage5_engine.py and its mirror in core/validate.ts.`
  return { type, verdict: 'unvalidated', score: 0, computed: {}, formulas: [], tiles: [], reasons: [reason],
    checks: [check('physics', 'Stage 5 physics implemented', 'Engineering checks for this part are still being set up', false, reason,
      'Engineering checks for this type of part are still being set up.', 'docs/ADDING_A_PART.md')] }
}

/** A registry part without physics must never borrow another part's validator. */
export function validateDesign(d: Design, label?: string): Scorecard {
  const t = d.part_type
  if (!isImplemented(t)) return unvalidated(t, label ?? t)
  if (t === 'feed_screw') return feedScrew(d)
  if (t === 'guide_rail') return guideRail(d)
  return starwheel(d)
}
