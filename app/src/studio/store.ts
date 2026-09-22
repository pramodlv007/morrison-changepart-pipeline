/**
 * Engineer Studio session state. Everything an engineer produces in a session — inputs,
 * prompt edits, model choices, each stage's output and run history — lives here and is
 * persisted to sessionStorage (closing the tab clears it; a refresh keeps it).
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { StageId, Spec, BranchEval } from '@/core/pipeline'
import type { CallMeta } from '@/core/ollama'
import type { Design } from '@/core/validate'
import { BUNDLED_REGISTRY, type Registry } from '@/core/registry'

export type Status = 'idle' | 'running' | 'done' | 'error' | 'stale' | 'blocked'
export interface Run {
  id: string
  stage: StageId
  ts: number
  ok: boolean
  model?: string
  system?: string
  user?: string
  output?: string
  meta?: CallMeta
  error?: { title: string; detail: string; hint: string }
  notes?: string[]
  iteration?: number
}
export interface Ranked { id: string; part_type: string; text: string; outcome: string; sim: number; score: number }
export interface LoopStep { iteration: number; verdict: string; route: 'stage1' | 'stage3' | 'none'; failing: string[]; hints: string[]; ts: number }
export interface TraceEvent { ts: number; stage: StageId | 'sys'; level: 'info' | 'ok' | 'warn' | 'error'; msg: string }

export const COMMON_KEYS = ['machine_id', 'material_id', 'target_speed_cpm', 'bottle_diameter_mm', 'bottle_height_mm', 'ovality_mm'] as const
export const DEFAULT_COMMON: Record<string, any> = { machine_id: 'CAP-16', material_id: 'UHMW-PE', target_speed_cpm: 380, bottle_diameter_mm: 54, bottle_height_mm: 210, ovality_mm: 0.6 }

interface State {
  partType: string
  params: Record<string, any>
  common: Record<string, any>
  email: string
  models: Partial<Record<StageId, string>>
  temps: Partial<Record<StageId, number>>
  prompts: Partial<Record<StageId, string>>
  selected: StageId
  tab: string
  status: Partial<Record<StageId, Status>>
  runs: Partial<Record<StageId, Run[]>>
  spec: Spec | null
  grounding: string[]
  ranked: Ranked[] | null
  branches: BranchEval[] | null
  pickedBranch: string | null
  cad: { script: string; checks: { label: string; ok: boolean }[] } | null
  loop: { enabled: boolean; max: number; history: LoopStep[] }
  feedback: { stage1: string | null; stage3: string | null }
  published: { id: string; url: string; ts: number } | null
  refine: { instruction: string; delta: Record<string, any> | null; drift: string[]; ignored: string[] } | null
  trace: TraceEvent[]
  view: 'pipeline' | 'cad'
  baseline: Design | null
}
interface Actions {
  set: (p: Partial<State>) => void
  setParam: (k: string, v: any) => void
  setPartType: (t: string, reg?: Registry) => void
  loadDesign: (d: Design) => void
  setStatus: (id: StageId, s: Status) => void
  addRun: (r: Run) => void
  log: (stage: TraceEvent['stage'], level: TraceEvent['level'], msg: string) => void
  resetSession: () => void
}

const initial = (): State => {
  const sw = BUNDLED_REGISTRY.parts.starwheel
  return {
    partType: 'starwheel',
    params: { ...sw.defaults },
    common: { ...DEFAULT_COMMON, ...sw.commonDefaults },
    email: Object.values(sw.samples)[0]?.text ?? '',
    models: {}, temps: {}, prompts: {},
    selected: '1', tab: 'overview',
    status: {}, runs: {},
    spec: null, grounding: [], ranked: null, branches: null, pickedBranch: null, cad: null,
    loop: { enabled: true, max: 3, history: [] },
    feedback: { stage1: null, stage3: null },
    published: null, refine: null, trace: [], view: 'pipeline', baseline: null,
  }
}

export const useStudio = create<State & Actions>()(persist((set, get) => ({
  ...initial(),
  set: p => set(p),
  setParam: (k, v) => {
    if ((COMMON_KEYS as readonly string[]).includes(k)) set(s => ({ common: { ...s.common, [k]: v } }))
    else set(s => ({ params: { ...s.params, [k]: v } }))
  },
  setPartType: (t, reg = BUNDLED_REGISTRY) => {
    const T = reg.parts[t]
    if (!T) return
    set(s => ({ partType: t, params: { ...T.defaults }, common: { ...s.common, ...T.commonDefaults } }))
  },
  loadDesign: d => {
    const { part_type, ...rest } = d
    const params: Record<string, any> = {}, common: Record<string, any> = { ...get().common }
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined || v === null) continue
      if ((COMMON_KEYS as readonly string[]).includes(k)) common[k] = v
      else params[k] = v
    }
    set({ partType: part_type, params, common })
  },
  setStatus: (id, st) => set(s => ({ status: { ...s.status, [id]: st } })),
  addRun: r => set(s => ({ runs: { ...s.runs, [r.stage]: [r, ...(s.runs[r.stage] ?? [])].slice(0, 10) } })),
  log: (stage, level, msg) => set(s => ({ trace: [...s.trace, { ts: Date.now(), stage, level, msg }].slice(-300) })),
  resetSession: () => set({ ...initial() }),
}), {
  name: 'cps-studio-v3',
  storage: createJSONStorage(() => sessionStorage),
  version: 1,
  // A tab closed mid-run must not come back showing "running" forever.
  onRehydrateStorage: () => s => {
    if (!s) return
    const st = { ...s.status }
    for (const k of Object.keys(st) as StageId[]) if (st[k] === 'running') st[k] = 'error'
    s.set({ status: st })
  },
}))

export const designOf = (s: Pick<State, 'partType' | 'params' | 'common'>): Design => ({ part_type: s.partType, ...s.params, ...s.common })
export const useDesign = () => {
  const partType = useStudio(s => s.partType), params = useStudio(s => s.params), common = useStudio(s => s.common)
  return designFromParts(partType, params, common)
}
let memo: { k: [string, object, object]; d: Design } | null = null
function designFromParts(t: string, p: object, c: object): Design {
  if (memo && memo.k[0] === t && memo.k[1] === p && memo.k[2] === c) return memo.d
  const d = { part_type: t, ...p, ...c } as Design
  memo = { k: [t, p, c], d }
  return d
}

/* Non-persisted runtime state: registry, installed models, live token streams, health. */
interface Runtime {
  registry: Registry
  installed: string[]
  health: { backend: boolean; ollama: boolean; cadquery: boolean; checked: boolean }
  streams: Partial<Record<StageId, string>>
  running: boolean
  runningStage: StageId | null
  set: (p: Partial<Runtime>) => void
  stream: (id: StageId, text: string) => void
}
export const useRuntime = create<Runtime>(set => ({
  registry: BUNDLED_REGISTRY,
  installed: [],
  health: { backend: false, ollama: false, cadquery: false, checked: false },
  streams: {},
  running: false,
  runningStage: null,
  set: p => set(p),
  stream: (id, text) => set(s => ({ streams: { ...s.streams, [id]: text } })),
}))
