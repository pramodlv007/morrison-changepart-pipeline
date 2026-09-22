import { describe, expect, it } from 'vitest'
import { validateDesign } from './validate'
import { classifyFailure, feedbackPacket, repairHints } from './repair'
import { chooseBranch, extractBranches, fillTemplate, groundingFlags, mergedDesign, specSummary, stage3Context, templateVars, DEFAULT_PROMPTS, promptVars } from './pipeline'
import { BUNDLED_REGISTRY as REG } from './registry'

const SW = { part_type: 'starwheel', pocket_count: 16, pcd_mm: 620, pocket_radius_mm: 32.8, pocket_clearance_mm: 0.8,
  machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380, ovality_mm: 0.6, bottle_diameter_mm: 54 }
const FS = { part_type: 'feed_screw', pitch_mm: 80, outer_diameter_mm: 140, root_diameter_mm: 90, length_mm: 480, starts: 2,
  flight_thickness_mm: 10, bottle_diameter_mm: 66, machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380, ovality_mm: 0.6 }
const FALLBACK = { type: 'starwheel', params: { ...REG.parts.starwheel.defaults },
  common: { machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380, bottle_diameter_mm: 54, bottle_height_mm: 210, ovality_mm: 0.6 } }

describe('feedback routing', () => {
  it('sends geometry failures to Stage 3 and spec conflicts to Stage 1', () => {
    expect(classifyFailure(validateDesign({ ...SW, pocket_clearance_mm: 0.35 })).route).toBe('stage3')
    expect(classifyFailure(validateDesign({ ...SW, material_id: 'mild steel' })).route).toBe('stage1')
    expect(classifyFailure(validateDesign({ ...SW, target_speed_cpm: 500 })).route).toBe('stage1')
    expect(classifyFailure(validateDesign(SW)).route).toBe('none')
  })
})

describe('repair hints invert the formulas', () => {
  it('starwheel clearance: must exceed floor + ovality/2', () => {
    const d = { ...SW, pocket_clearance_mm: 0.35 }
    expect(repairHints(validateDesign(d), d)[0]).toMatch(/MORE than 0.5/)
  })
  it('feed screw: pitch floor and required starts', () => {
    const d = { ...FS, starts: 1, pitch_mm: 70 }
    const h = repairHints(validateDesign(d), d)
    expect(h.some(x => /pitch_mm must be MORE than 76.5/.test(x))).toBe(true)
    expect(h.some(x => /starts must be AT LEAST 2/.test(x))).toBe(true)
  })
  it('the packet carries failures, corrections and limits', () => {
    const d = { ...SW, pocket_clearance_mm: 0.35 }
    const p = feedbackPacket(validateDesign(d), d, 1, 'Starwheel')
    expect(p).toMatch(/REJECTED/); expect(p).toMatch(/REQUIRED CORRECTIONS/); expect(p).toMatch(/Hard limits/)
  })
})

describe('prompt templates', () => {
  it('lists and fills variables', () => {
    const vars = templateVars(DEFAULT_PROMPTS['3']!)
    expect(vars).toEqual(expect.arrayContaining(['part_type', 'machine_limits', 'branch_fields', 'materials']))
    const filled = fillTemplate(DEFAULT_PROMPTS['3']!, promptVars('3', { reg: REG, type: 'feed_screw', machineId: 'CAP-16' }))
    expect(filled).toMatch(/350 rpm/)
    expect(filled).not.toMatch(/\{\{/)
  })
})

describe('chaining', () => {
  it('summarises a spec for retrieval', () => {
    expect(specSummary({ part_type: 'guide_rail', arc_angle_deg: 120, mating_pcd_mm: 620 }, REG)).toMatch(/guide rail, 120° arc, on PCD 620mm/)
  })
  it('falls back to the part’s own precedent library before Stage 2 has run', () => {
    expect(stage3Context({ part_type: 'feed_screw' }, null, REG, 'starwheel')).toMatch(/FS-20417/)
  })
  it('flags numbers that do not appear in the source text', () => {
    expect(groundingFlags({ pitch_mm: 80, length_mm: 480 }, 'about 480mm long')).toEqual(['pitch_mm=80'])
  })
  it('picks the recommended branch only if it passes the gate', () => {
    const text = JSON.stringify({ branches: [
      { branch_id: 'A', pocket_clearance_mm: 0.3 },
      { branch_id: 'B', pocket_clearance_mm: 0.35, recommended: true },
      { branch_id: 'C', pocket_clearance_mm: 0.9, material_id: 1 } ] })
    const { evaluated, pick } = chooseBranch({ part_type: 'starwheel', machine_id: 'CAP-16' }, extractBranches(text)!, REG, FALLBACK)
    expect(evaluated.map(e => e.card.verdict)).toEqual(['reject', 'reject', 'accept'])
    expect(pick.branch.branch_id).toBe('C')
    expect(pick.branch._material_dropped).toBe(1)
    expect(pick.design.material_id).toBe('UHMW-PE')
  })
  it('merges spec, branch and viewer state into one design', () => {
    const d = mergedDesign({ part_type: 'starwheel', target_speed_cpm: 420 }, { pocket_count: 12 }, REG, FALLBACK)
    expect(d).toMatchObject({ part_type: 'starwheel', pocket_count: 12, target_speed_cpm: 420, machine_id: 'CAP-16' })
  })
})
