/** The live design: 3D/2D viewer, parameters with safe zones, operating conditions and the gate. */
import { useMemo, useState } from 'react'
import { Maximize, RotateCcw } from 'lucide-react'
import { validateDesign, type Design } from '@/core/validate'
import { MACHINES, MATERIALS } from '@/core/standards'
import { safeBands } from '@/core/safezone'
import type { SliderDef } from '@/core/registry'
import { Viewer, type Tool } from '@/cad/Viewer'
import { ParamSlider } from '@/ui/ParamSlider'
import { Button, NativeSelect, SectionTitle } from '@/ui/primitives'
import { TabPanel, Tabs } from '@/ui/overlay'
import { useDesign, useRuntime, useStudio } from './store'
import { Scorecard, VerdictPill } from './Scorecard'

export const ENGINEER_TOOLS: Tool[] = ['drawing', 'handles', 'rotate', 'explode', 'containers', 'dims', 'section', 'measure', 'compare', 'screenshot', 'fullscreen']

/** Registry sliders plus the customer controls (e.g. pocket clearance), de-duplicated. */
export function useSliders(): SliderDef[] {
  const reg = useRuntime(r => r.registry), partType = useStudio(s => s.partType)
  return useMemo(() => {
    const T = reg.parts[partType]
    if (!T) return []
    const seen = new Set<string>(), out: SliderDef[] = []
    for (const s of [...T.sliders, ...T.customerControls]) if (!seen.has(s.k)) { seen.add(s.k); out.push({ k: s.k, l: s.l, min: s.min, max: s.max, step: s.step }) }
    // widen to include the current default so a value is never off the track
    return out.map(s => ({ ...s, min: Math.min(s.min, Number(T.defaults[s.k] ?? s.min)), max: Math.max(s.max, Number(T.defaults[s.k] ?? s.max)) }))
  }, [reg, partType])
}
export const unitOf = (k: string) => (k.endsWith('_mm') ? 'mm' : k.endsWith('_deg') ? '°' : k.endsWith('_cpm') ? 'cpm' : '')

export function ParamList({ design, sliders, onFocus, filter }: { design: Design; sliders: SliderDef[]; onFocus?: (k: string | null) => void; filter?: string[] | null }) {
  const setParam = useStudio(s => s.setParam), baseline = useStudio(s => s.baseline)
  const list = filter ? sliders.filter(s => filter.includes(s.k)) : sliders
  const bands = useMemo(() => Object.fromEntries(list.map(s => [s.k, safeBands(design, s.k, s.min, s.max, 48)])), [design, list])
  return (
    <div className="divide-y divide-border/60">
      {list.map(s => (
        <div key={s.k} onPointerEnter={() => onFocus?.(s.k)} onPointerLeave={() => onFocus?.(null)} onFocus={() => onFocus?.(s.k)}>
          <ParamSlider id={s.k} label={s.l.replace(/\s*\(.*?\)\s*$/, '')} value={Number(design[s.k] ?? s.min)} min={s.min} max={s.max} step={s.step}
            unit={unitOf(s.k)} bands={bands[s.k]} baseline={baseline && baseline.part_type === design.part_type ? Number(baseline[s.k]) : undefined}
            onReset={baseline ? () => setParam(s.k, baseline[s.k]) : undefined}
            onChange={v => setParam(s.k, v)} />
        </div>
      ))}
    </div>
  )
}

export function OperatingConditions({ design }: { design: Design }) {
  const setParam = useStudio(s => s.setParam)
  const m = MACHINES[String(design.machine_id)]
  const speedMax = Math.round((m?.maxCpm ?? 600) * 1.25 / 10) * 10
  const speedBands = useMemo(() => safeBands(design, 'target_speed_cpm', 60, speedMax, 48), [design, speedMax])
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Machine</span>
          <NativeSelect aria-label="Machine" className="w-full" value={String(design.machine_id)} onChange={v => setParam('machine_id', v)}
            options={Object.values(MACHINES).map(x => ({ value: x.id, label: `${x.id} · ${x.maxCpm} cpm` }))} />
        </label>
        <label className="block"><span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Material</span>
          <NativeSelect aria-label="Material" className="w-full" value={String(design.material_id)} onChange={v => setParam('material_id', v)}
            options={Object.values(MATERIALS).map(x => ({ value: x.id, label: `${x.id}${x.compliant ? '' : ' · not food-safe'}` }))} />
        </label>
      </div>
      <div className="divide-y divide-border/60">
        <ParamSlider id="target_speed_cpm" label="Target speed" unit="cpm" value={Number(design.target_speed_cpm)} min={60} max={speedMax} step={10} bands={speedBands} onChange={v => setParam('target_speed_cpm', v)} />
        <ParamSlider id="bottle_diameter_mm" label="Container diameter" unit="mm" value={Number(design.bottle_diameter_mm)} min={30} max={120} step={0.5} onChange={v => setParam('bottle_diameter_mm', v)} />
        <ParamSlider id="bottle_height_mm" label="Container height" unit="mm" value={Number(design.bottle_height_mm)} min={80} max={400} step={5} onChange={v => setParam('bottle_height_mm', v)} />
        <ParamSlider id="ovality_mm" label="Container ovality" unit="mm" value={Number(design.ovality_mm)} min={0} max={2} step={0.05} onChange={v => setParam('ovality_mm', v)} />
      </div>
    </div>
  )
}

export function DesignPanel() {
  const design = useDesign(), sliders = useSliders()
  const reg = useRuntime(r => r.registry), baseline = useStudio(s => s.baseline), set = useStudio(s => s.set), loadDesign = useStudio(s => s.loadDesign)
  const setParam = useStudio(s => s.setParam)
  const [tab, setTab] = useState('params')
  const [focus, setFocus] = useState<string | null>(null)
  const T = reg.parts[design.part_type], label = T?.label ?? design.part_type
  const card = useMemo(() => validateDesign(design, label), [design, label])

  return (
    <aside aria-label="Design" className="flex h-full min-w-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Live design</div>
          <div className="truncate text-[14px] font-semibold text-ink">{label}</div>
        </div>
        <VerdictPill card={card} size="sm" />
        <Button size="sm" variant="ghost" icon={<Maximize className="size-3.5" />} onClick={() => set({ view: 'cad' })}>CAD</Button>
      </div>
      <Viewer design={design} label={label} theme="studio" tools={ENGINEER_TOOLS} onParam={setParam} limits={sliders} hotspots={T?.hotspots}
        compareTo={baseline && baseline.part_type === design.part_type ? baseline : null} focusKey={focus}
        className="h-[44%] min-h-64 shrink-0 border-b border-border" />
      <Tabs value={tab} onChange={setTab} className="flex-1" tabs={[{ value: 'params', label: 'Geometry' }, { value: 'operating', label: 'Operating' }, { value: 'gate', label: 'Validation' }]}>
        <TabPanel value="params" className="px-4 py-2">
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11.5px] text-ink-3">Green on a track = values that pass Stage 5</span>
            {baseline && baseline.part_type === design.part_type && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => loadDesign(baseline)}>Revert</Button>}
          </div>
          <ParamList design={design} sliders={sliders} onFocus={setFocus} />
        </TabPanel>
        <TabPanel value="operating" className="px-4 py-3"><OperatingConditions design={design} /></TabPanel>
        <TabPanel value="gate" className="px-4 py-3"><Scorecard design={design} label={label} compact /></TabPanel>
      </Tabs>
    </aside>
  )
}

/* ---------------- CAD workspace (full-width mode) ---------------- */
const FEATURES: Record<string, { name: string; keys: string[] }[]> = {
  starwheel: [
    { name: 'Disk', keys: ['pcd_mm', 'wheel_thickness_mm'] },
    { name: 'Pocket pattern', keys: ['pocket_count', 'pocket_radius_mm', 'pocket_clearance_mm'] },
    { name: 'Bore & hub', keys: [] },
  ],
  feed_screw: [
    { name: 'Core', keys: ['root_diameter_mm', 'length_mm'] },
    { name: 'Helical flights', keys: ['pitch_mm', 'outer_diameter_mm', 'flight_thickness_mm', 'starts'] },
    { name: 'Drive shaft', keys: [] },
  ],
  guide_rail: [
    { name: 'Rail profile', keys: ['rail_radius_mm', 'thickness_mm', 'rail_height_mm'] },
    { name: 'Arc', keys: ['arc_angle_deg'] },
    { name: 'Contact band', keys: ['contact_height_mm'] },
  ],
}

export function CadWorkspace() {
  const design = useDesign(), sliders = useSliders(), reg = useRuntime(r => r.registry), baseline = useStudio(s => s.baseline)
  const setParam = useStudio(s => s.setParam)
  const [feature, setFeature] = useState<number | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const T = reg.parts[design.part_type], label = T?.label ?? design.part_type
  const feats = FEATURES[design.part_type] ?? []
  const filter = feature !== null ? feats[feature]?.keys ?? null : null

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)_340px] max-lg:grid-cols-[minmax(0,1fr)_320px]">
      <nav aria-label="Feature tree" className="overflow-y-auto border-r border-border bg-surface p-3 max-lg:hidden">
        <SectionTitle>Feature tree</SectionTitle>
        <button onClick={() => setFeature(null)} className={`w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium cursor-pointer ${feature === null ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2'}`}>{label}</button>
        <ul className="ml-3 mt-1 space-y-0.5 border-l border-border pl-2">
          {feats.map((f, i) => (
            <li key={f.name}>
              <button onClick={() => setFeature(i)} className={`w-full rounded-md px-2 py-1.5 text-left text-[12.5px] cursor-pointer ${feature === i ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2'}`}>
                {f.name}{f.keys.length ? <span className="ml-1 text-ink-3">· {f.keys.length}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-6 rounded-lg border border-border bg-surface-2/50 p-2.5 text-[11.5px] leading-relaxed text-ink-3">
          Drag the handles in the viewport, or edit values on the right. Every change re-runs Stage 5 instantly.
        </div>
      </nav>
      <Viewer design={design} label={label} theme="studio" tools={ENGINEER_TOOLS} onParam={setParam} limits={sliders} hotspots={T?.hotspots}
        compareTo={baseline && baseline.part_type === design.part_type ? baseline : null} focusKey={focus} initial={{ dims: true }} className="h-full min-h-0" />
      <aside className="overflow-y-auto border-l border-border bg-surface px-4 py-3">
        <SectionTitle>{filter ? feats[feature!].name : 'Properties'}</SectionTitle>
        {filter && filter.length === 0 ? <p className="text-[12.5px] text-ink-3">Standard feature — sized from the machine interface, not edited per design.</p>
          : <ParamList design={design} sliders={sliders} onFocus={setFocus} filter={filter} />}
        <div className="mt-5"><SectionTitle>Validation</SectionTitle><Scorecard design={design} label={label} compact /></div>
      </aside>
    </div>
  )
}
