/**
 * Part-type registry. parts/registry.json is bundled as the baseline; at runtime the
 * backend serves the same file merged with any parts/*.part.json overlays, which is
 * how a new change part is added without touching code.
 */
import bundled from '../../../parts/registry.json'

export interface SliderDef { k: string; l: string; min: number; max: number; step: number }
export interface CustomerControl extends SliderDef { lo?: string; hi?: string; help?: string }
export interface DimDef { k: string; l: string; u: string }
export interface Hotspot { at: string; title: string; body: string }
export interface CadCheck { pattern: string; flags: string; label: string }
export interface SampleEmail { label: string; text: string }

export interface PartType {
  key: string
  label: string
  summary: string
  defaults: Record<string, number | string>
  commonDefaults: Record<string, number>
  sliders: SliderDef[]
  customerDims: DimDef[]
  customerControls: CustomerControl[]
  hotspots: Hotspot[]
  branchFields: string[]
  cadHint: string
  cadChecks: CadCheck[]
  samples: Record<string, SampleEmail>
}

export interface Precedent { id: string; part_type: string; text: string; outcome: 'clean' | 'jammed' | string }

export interface Registry {
  version: string
  parts: Record<string, PartType>
  precedents: Precedent[]
  overlays: string[]
  errors: string[]
}

export function parseRegistry(raw: any): Registry {
  const parts: Record<string, PartType> = {}
  for (const [key, p] of Object.entries<any>(raw.part_types ?? {})) {
    parts[key] = {
      key,
      label: p.label ?? key,
      summary: p.summary_for_customer ?? '',
      defaults: { ...(p.defaults ?? {}) },
      commonDefaults: { ...(p.common_defaults ?? {}) },
      sliders: p.sliders ?? [],
      customerDims: p.customer_dimensions ?? [],
      customerControls: p.customer_controls ?? [],
      hotspots: p.hotspots ?? [],
      branchFields: p.branch_fields ?? [],
      cadHint: p.cad_hint ?? '',
      cadChecks: p.cad_checks ?? [],
      samples: p.sample_emails ?? {},
    }
  }
  return {
    version: String(raw.version ?? '?'),
    parts,
    precedents: raw.precedents ?? [],
    overlays: raw.overlays ?? [],
    errors: raw.errors ?? [],
  }
}

export const BUNDLED_REGISTRY = parseRegistry(bundled)

/** Parts that have a physics validator AND a geometry builder. Registry-only parts are UNVALIDATED. */
export const IMPLEMENTED_PARTS = ['starwheel', 'feed_screw', 'guide_rail'] as const
export type ImplementedPart = typeof IMPLEMENTED_PARTS[number]
export const isImplemented = (k: string): k is ImplementedPart => (IMPLEMENTED_PARTS as readonly string[]).includes(k)
