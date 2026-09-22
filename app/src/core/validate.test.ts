import { describe, expect, it } from 'vitest'
import { validateDesign } from './validate'

/* Reference cases shared with test_stage5_validation.py — the browser mirror must
   reproduce the Python engine's numbers exactly. */
const SW = { part_type: 'starwheel', pocket_count: 16, pcd_mm: 620, pocket_radius_mm: 32.8, pocket_clearance_mm: 0.8,
  machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380, ovality_mm: 0.6 }
const FS = { part_type: 'feed_screw', pitch_mm: 80, outer_diameter_mm: 140, root_diameter_mm: 90, length_mm: 480, starts: 2,
  flight_thickness_mm: 10, bottle_diameter_mm: 66, machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380, ovality_mm: 0.6 }
const GR = { part_type: 'guide_rail', rail_radius_mm: 340, arc_angle_deg: 120, rail_height_mm: 25, thickness_mm: 12,
  contact_height_mm: 95, mating_pcd_mm: 620, bottle_diameter_mm: 54, bottle_height_mm: 210, machine_id: 'CAP-16',
  material_id: 'UHMW-PE', target_speed_cpm: 380, ovality_mm: 0.6 }
const fail = (r: ReturnType<typeof validateDesign>) => r.checks.filter(c => !c.pass).map(c => c.id)

describe('starwheel', () => {
  it('reproduces the published Branch A accept', () => {
    const r = validateDesign(SW)
    expect(r.verdict).toBe('accept')
    expect(r.computed.web).toBe(55.36)
    expect(r.computed.effectiveClearance).toBe(0.5)
    expect(r.computed.utilisation).toBe(0.844)
    expect(r.score).toBe(0.8)
  })
  it('rejects Branch C (SW-10884 jam) on clearance', () => {
    const r = validateDesign({ ...SW, pocket_clearance_mm: 0.35 })
    expect(r.verdict).toBe('reject')
    expect(fail(r)).toEqual(['clearance'])
  })
  it('treats exactly 0.20 mm as a reject (strict inequality)', () => {
    expect(validateDesign({ ...SW, pocket_clearance_mm: 0.5 }).verdict).toBe('reject')
  })
  it('rejects overspeed, non-food material, unknown material (fails closed), thin web', () => {
    expect(fail(validateDesign({ ...SW, target_speed_cpm: 480 }))).toEqual(['speed'])
    expect(fail(validateDesign({ ...SW, material_id: 'mild steel' }))).toEqual(['food'])
    expect(fail(validateDesign({ ...SW, material_id: 'acme-900' }))).toEqual(['food'])
    expect(fail(validateDesign({ ...SW, pocket_radius_mm: 57.98 }))).toEqual(['web'])
  })
})

describe('feed screw', () => {
  it('accepts the 2-start reference with Python-identical numbers', () => {
    const r = validateDesign(FS)
    expect(r.verdict).toBe('accept')
    expect(r.computed.clearance).toBe(4)
    expect(r.computed.effectiveClearance).toBe(3.7)
    expect(r.computed.containersEngaged).toBe(6)
    expect(r.computed.rpm).toBe(190)
    expect(r.computed.torqueNm).toBe(5.05)
  })
  it('rejects a single start on the drive rpm limit', () => {
    const r = validateDesign({ ...FS, starts: 1 })
    expect(fail(r)).toEqual(['rpm'])
    expect(r.reasons[0]).toMatch(/380 rpm/)
  })
  it('rejects tight pockets, excess back-pressure, short screws', () => {
    expect(fail(validateDesign({ ...FS, pitch_mm: 70 }))).toContain('clearance')
    expect(fail(validateDesign({ ...FS, accumulation_backpressure_n: 200 }))).toEqual(['torque'])
    expect(fail(validateDesign({ ...FS, length_mm: 200 }))).toEqual(['bottles'])
  })
})

describe('guide rail', () => {
  it('accepts the reference rail', () => {
    const r = validateDesign(GR)
    expect(r.verdict).toBe('accept')
    expect(r.computed.gap).toBe(3)
    expect(r.computed.effectiveGap).toBe(2.7)
    expect(r.computed.matingPockets).toBe(16)
    expect(r.computed.containersInArc).toBe(5)
  })
  it('rejects wrap past 180°, shoulder contact, loose gap, collision', () => {
    expect(fail(validateDesign({ ...GR, arc_angle_deg: 200 }))).toEqual(['arc'])
    expect(fail(validateDesign({ ...GR, contact_height_mm: 190 }))).toEqual(['contact'])
    expect(fail(validateDesign({ ...GR, rail_radius_mm: 345 }))).toEqual(['maxGap'])
    expect(fail(validateDesign({ ...GR, rail_radius_mm: 330 }))).toContain('geometry')
  })
})

describe('dispatch', () => {
  it('never borrows another part’s validator for an unimplemented type', () => {
    const r = validateDesign({ part_type: 'gripper', jaw_opening_mm: 28 }, 'Gripper Jaw')
    expect(r.verdict).toBe('unvalidated')
    expect(r.checks[0].id).toBe('physics')
  })
  it('every check carries both engineering and customer wording', () => {
    for (const d of [SW, FS, GR]) {
      for (const c of validateDesign(d).checks) {
        expect(c.label.length).toBeGreaterThan(3)
        expect(c.plain.length).toBeGreaterThan(3)
      }
    }
  })
})
