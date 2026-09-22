/** Python backend: registry, the reference Stage 5 engine, STEP export and the customer hand-off store. */
import { parseRegistry, type Registry } from './registry'
import type { Design, Scorecard } from './validate'

export interface Health { cadquery: boolean; registry_version: string; part_types: string[]; overlays: string[]; errors: string[]; ollama?: boolean }

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as any).error ?? `HTTP ${r.status}`)
  return j as T
}

export async function health(): Promise<Health | null> {
  try { return await json<Health>(await fetch('/api/health?ollama=1')) } catch { return null }
}
export async function loadRegistry(): Promise<Registry | null> {
  try { return parseRegistry(await json(await fetch('/api/registry'))) } catch { return null }
}
export async function validateRemote(d: Design): Promise<any> {
  return json(await fetch('/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ part_type: d.part_type, params: d, ovality_mm: d.ovality_mm }) }))
}
export async function downloadStep(d: Design): Promise<void> {
  const r = await fetch('/api/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ part_type: d.part_type, params: d }) })
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as any).error ?? `HTTP ${r.status}`) }
  const blob = await r.blob()
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${d.part_type}.step` })
  document.body.appendChild(a); a.click(); a.remove()
}

/* ---------------- customer hand-off ---------------- */
export interface CustomerPayload {
  version: 3
  part_type: string
  label: string
  summary: string
  design: Design
  spec: Record<string, any>
  open_questions: string[]
  verdict: Scorecard['verdict']
  created: string
}
export interface CustomerResponse { kind: 'approve' | 'request'; text: string; adjustments: Record<string, any>; answers: { q: string; a: string }[]; ts: string }
export interface DesignRecord { id: string; payload: CustomerPayload; responses: CustomerResponse[]; created: string; updated: string }
export interface CustomerRequest { id: string; contact: string; company: string; part_type: string; details: Record<string, any>; notes: string; ts: string }

const H = { 'Content-Type': 'application/json' }
export const publishDesign = async (payload: CustomerPayload, id?: string) =>
  json<{ id: string }>(await fetch(id ? `/api/designs/${id}` : '/api/designs', { method: id ? 'PUT' : 'POST', headers: H, body: JSON.stringify(payload) }))
export const getDesign = async (id: string) => json<DesignRecord>(await fetch(`/api/designs/${encodeURIComponent(id)}`))
export const listDesigns = async () => json<DesignRecord[]>(await fetch('/api/designs'))
export const respond = async (id: string, r: Omit<CustomerResponse, 'ts'>) =>
  json<{ ok: true }>(await fetch(`/api/designs/${encodeURIComponent(id)}/responses`, { method: 'POST', headers: H, body: JSON.stringify(r) }))
export const submitRequest = async (r: Omit<CustomerRequest, 'id' | 'ts'>) =>
  json<{ id: string }>(await fetch('/api/requests', { method: 'POST', headers: H, body: JSON.stringify(r) }))
export const listRequests = async () => json<CustomerRequest[]>(await fetch('/api/requests'))
