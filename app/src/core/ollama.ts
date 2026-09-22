/**
 * Local LLM client. Calls go through the backend proxy (/api/ollama), so the browser
 * never needs OLLAMA_ORIGINS configured and nothing leaves the company network.
 * Streams tokens — local runs take 1–3 minutes and a live stream beats a spinner.
 */
const BASE = '/api/ollama'

export interface CallMeta { ms: number; promptTokens: number; evalTokens: number; tokPerSec: number | null; loadMs: number }
export interface ChatResult { text: string; meta: CallMeta }
export class OllamaError extends Error {
  constructor(message: string, public notFound = false, public unreachable = false) { super(message) }
}

function meta(j: any, ms: number): CallMeta {
  const evalS = (j?.eval_duration ?? 0) / 1e9
  return { ms: Math.round(ms), promptTokens: j?.prompt_eval_count ?? 0, evalTokens: j?.eval_count ?? 0,
    tokPerSec: evalS > 0 ? Math.round((j.eval_count / evalS) * 10) / 10 : null, loadMs: Math.round((j?.load_duration ?? 0) / 1e6) }
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let r: Response
  try {
    r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new OllamaError('Could not reach the backend. Start it with: python serve.py', false, true)
  }
  if (!r.ok) {
    const j = await r.json().catch(() => null)
    const msg = j?.error ?? `HTTP ${r.status}`
    throw new OllamaError(msg, /not found/i.test(msg), r.status === 502 || r.status === 503)
  }
  return r
}

export async function listModels(): Promise<string[]> {
  try {
    const r = await fetch(BASE + '/api/tags')
    if (!r.ok) return []
    const j = await r.json()
    return (j.models ?? []).map((m: any) => m.name)
  } catch { return [] }
}

export interface ChatArgs {
  model: string
  system?: string
  user: string
  images?: string[]
  json?: boolean
  temperature?: number
  signal?: AbortSignal
  onToken?: (textSoFar: string) => void
}

export async function chat(a: ChatArgs): Promise<ChatResult> {
  const t0 = performance.now()
  const messages: any[] = []
  if (a.system) messages.push({ role: 'system', content: a.system })
  messages.push({ role: 'user', content: a.user, ...(a.images?.length ? { images: a.images } : {}) })
  const body: any = { model: a.model, messages, stream: true }
  if (a.json) body.format = 'json'
  if (a.temperature !== undefined) body.options = { temperature: a.temperature }
  const r = await post('/api/chat', body, a.signal)
  const reader = r.body!.getReader()
  const dec = new TextDecoder()
  let buf = '', text = '', last: any = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line) continue
      const j = JSON.parse(line)
      if (j.error) throw new OllamaError(j.error, /not found/i.test(j.error))
      if (j.message?.content) { text += j.message.content; a.onToken?.(text) }
      if (j.done) last = j
    }
  }
  return { text, meta: meta(last, performance.now() - t0) }
}

export async function embed(model: string, text: string, signal?: AbortSignal): Promise<number[]> {
  const r = await post('/api/embeddings', { model, prompt: text }, signal)
  const j = await r.json()
  if (!j?.embedding) throw new OllamaError('No embedding returned — is this an embedding-capable model?')
  return j.embedding
}

export function describeError(e: unknown, model: string): { title: string; detail: string; hint: string } {
  if ((e as any)?.name === 'AbortError') return { title: 'Stopped', detail: 'The run was cancelled.', hint: '' }
  if (e instanceof OllamaError) {
    if (e.notFound) return { title: 'Model not installed', detail: e.message, hint: `ollama pull ${model}` }
    if (e.unreachable) return { title: 'Ollama not reachable', detail: e.message, hint: 'Start Ollama, then re-run this stage.' }
    return { title: 'Model call failed', detail: e.message, hint: '' }
  }
  return { title: 'Unexpected error', detail: String((e as any)?.message ?? e), hint: '' }
}
