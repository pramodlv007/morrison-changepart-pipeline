/**
 * Customer review state for one published design. Edits, answers and the current step are
 * kept in sessionStorage (per design id) so a refresh never loses the customer's work.
 */
import { create } from 'zustand'
import type { DesignRecord } from '@/core/backend'
import type { Design } from '@/core/validate'

export type Step = 'requirements' | 'design' | 'checks' | 'approve'
interface Snapshot { edits: Record<string, any> }
interface State {
  id: string | null
  record: DesignRecord | null
  error: string | null
  step: Step
  edits: Record<string, any>
  past: Snapshot[]
  future: Snapshot[]
  answers: Record<string, string>
  message: string
  submitted: null | 'approve' | 'request'
  lastKey: { k: string; t: number } | null
  load: (id: string, record: DesignRecord) => void
  fail: (msg: string) => void
  setStep: (s: Step) => void
  edit: (k: string, v: any) => void
  undo: () => void
  redo: () => void
  reset: () => void
  answer: (q: string, a: string) => void
  setMessage: (m: string) => void
  markSubmitted: (k: 'approve' | 'request') => void
}

const key = (id: string) => `cps-portal-${id}`
const save = (s: State) => {
  if (!s.id) return
  try { sessionStorage.setItem(key(s.id), JSON.stringify({ step: s.step, edits: s.edits, answers: s.answers, message: s.message, submitted: s.submitted })) } catch { /* storage blocked */ }
}

export const usePortal = create<State>((set, get) => ({
  id: null, record: null, error: null, step: 'requirements', edits: {}, past: [], future: [], answers: {}, message: '', submitted: null, lastKey: null,
  load: (id, record) => {
    let saved: any = {}
    try { saved = JSON.parse(sessionStorage.getItem(key(id)) ?? '{}') } catch { /* ignore */ }
    set({ id, record, error: null, step: saved.step ?? 'requirements', edits: saved.edits ?? {}, answers: saved.answers ?? {}, message: saved.message ?? '', submitted: saved.submitted ?? null, past: [], future: [] })
  },
  fail: msg => set({ error: msg }),
  setStep: step => { set({ step }); save(get()); window.scrollTo({ top: 0, behavior: 'smooth' }) },
  edit: (k, v) => {
    const s = get(), now = Date.now()
    const current = k in s.edits ? s.edits[k] : s.record?.payload.design[k]
    if (String(current) === String(v)) return          // re-committing the same value is not an edit
    // Coalesce a continuous drag on one control into a single undo step.
    const coalesce = s.lastKey && s.lastKey.k === k && now - s.lastKey.t < 700
    const past = coalesce ? s.past : [...s.past, { edits: s.edits }].slice(-60)
    set({ edits: { ...s.edits, [k]: v }, past, future: [], lastKey: { k, t: now } })
    save(get())
  },
  undo: () => {
    const s = get(); if (!s.past.length) return
    set({ edits: s.past[s.past.length - 1].edits, past: s.past.slice(0, -1), future: [{ edits: s.edits }, ...s.future], lastKey: null }); save(get())
  },
  redo: () => {
    const s = get(); if (!s.future.length) return
    set({ edits: s.future[0].edits, future: s.future.slice(1), past: [...s.past, { edits: s.edits }], lastKey: null }); save(get())
  },
  reset: () => { const s = get(); if (!Object.keys(s.edits).length) return; set({ past: [...s.past, { edits: s.edits }], edits: {}, future: [], lastKey: null }); save(get()) },
  answer: (q, a) => { set(s => ({ answers: { ...s.answers, [q]: a } })); save(get()) },
  setMessage: m => { set({ message: m }); save(get()) },
  markSubmitted: k => { set({ submitted: k }); save(get()) },
}))

export const originalOf = (s: Pick<State, 'record'>): Design | null => s.record?.payload.design ?? null
export function currentOf(record: DesignRecord | null, edits: Record<string, any>): Design | null {
  return record ? { ...record.payload.design, ...edits } : null
}
