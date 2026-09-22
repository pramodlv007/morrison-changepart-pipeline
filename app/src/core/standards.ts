/**
 * Standards, machines and materials — read from the same validation_standards.json
 * the Python engine (stage5_engine.py) loads. Nothing here is hand-copied, so the
 * browser mirror and the Python engine cannot drift apart.
 */
import S from '../../../validation_standards.json'

export interface Machine {
  id: string
  maxCpm: number
  screwTorqueNm: number | null
  screwMaxRpm: number | null
  source: string
}
export interface Material {
  id: string
  name: string
  compliant: boolean
  citation: string
  allowableLoadN: number | null
  notes: string
}

const raw = S as any

export const MACHINES: Record<string, Machine> = Object.fromEntries(
  Object.entries(raw.machinery_catalog).map(([id, m]: [string, any]) => [id, {
    id,
    maxCpm: m.rated_max_speed_cpm,
    screwTorqueNm: m.infeed_screw_drive?.rated_torque_nm ?? null,
    screwMaxRpm: m.infeed_screw_drive?.max_screw_rpm ?? null,
    source: m.reference_source ?? '',
  }]),
)

export const MATERIALS: Record<string, Material> = Object.fromEntries(
  Object.entries(raw.food_contact_materials).map(([id, m]: [string, any]) => [id, {
    id,
    name: m.name ?? id,
    compliant: m.compliant === true,
    citation: m.fda_cfr_citation ?? '',
    allowableLoadN: m.allowable_contact_load_n ?? null,
    notes: m.notes ?? '',
  }]),
)

export const FOOD_SAFE_MATERIALS = Object.values(MATERIALS).filter(m => m.compliant).map(m => m.id)

const g = raw.geometric_thresholds
export const OVALITY: Record<string, number> = { ...g.bottle_ovality_tolerances_mm }

const fs = raw.feed_screw_thresholds
const gr = raw.guide_rail_thresholds
const cd = raw.container_defaults

export const LIMITS = {
  minEffectiveClearanceMm: Number(g.min_effective_clearance_mm),
  minWebMm: Number(g.min_web_thickness_mm),
  clearanceSource: String(g.clearance_reference_source ?? ''),
  webSource: String(g.web_reference_source ?? ''),
  screw: {
    maxClearanceMm: Number(fs.max_pocket_clearance_mm),
    minEngagement: Number(fs.min_flight_engagement_ratio),
    minFlightMm: Number(fs.min_flight_thickness_mm),
    minBottles: Number(fs.min_bottles_engaged),
    dynamicFactor: Number(fs.dynamic_load_factor),
    source: String(fs.reference_source ?? ''),
  },
  rail: {
    maxGapMm: Number(gr.max_running_gap_mm),
    minArcDeg: Number(gr.min_arc_angle_deg),
    maxArcDeg: Number(gr.max_arc_angle_deg),
    contactBand: gr.contact_height_band_of_bottle_height as [number, number],
    minThicknessMm: Number(gr.min_thickness_mm),
    minHeightMm: Number(gr.min_rail_height_mm),
    source: String(gr.reference_source ?? ''),
  },
} as const

export const CONTAINER = {
  massKg: Number(cd.filled_mass_kg),
  mu: Number(cd.friction_coefficient_container_on_uhmw),
  backpressureN: Number(cd.accumulation_backpressure_n),
  heightMm: Number(cd.bottle_height_mm),
}

export const DEFAULT_OVALITY = OVALITY.round_pet_water_bottle ?? 0.6
