/** Centre column: everything an engineer needs to understand, edit and re-run one stage. */
import { useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, Clock, Cpu, Play, RotateCcw, SkipForward } from 'lucide-react'
import { DEFAULT_PROMPTS, promptVars, stageById, templateVars, type StageId } from '@/core/pipeline'
import { useRuntime, useStudio, type Run } from './store'
import { resolveModel, runPipeline, runStage, systemPrompt } from './runner'
import { STAGE_ICON, KIND_LABEL, StatusIcon } from './PipelineRail'
import { StageInput } from './StageInput'
import { StageOutput } from './StageOutput'
import { Badge, Button, cn, CodeBlock, NativeSelect, SectionTitle, Textarea, Tip } from '@/ui/primitives'
import { TabPanel, Tabs } from '@/ui/overlay'

export const PROMPT_STAGES: StageId[] = ['1', '1b', '3', '4', '7']
export const MODEL_STAGES: StageId[] = ['1', '1b', '2', '3', '4', '7']
const RUNNABLE: StageId[] = ['1', '2', '3', '4', '5', '7']

export function Inspector() {
  const id = useStudio(s => s.selected), tab = useStudio(s => s.tab), set = useStudio(s => s.set)
  const status = useStudio(s => s.status[id]), runs = useStudio(s => s.runs[id]) ?? []
  const prompts = useStudio(s => s.prompts)
  const running = useRuntime(s => s.running), runningStage = useRuntime(s => s.runningStage)
  const st = stageById(id), Icon = STAGE_ICON[id]
  const hasPrompt = PROMPT_STAGES.includes(id), hasModel = MODEL_STAGES.includes(id)
  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'input', label: 'Input' },
    ...(hasPrompt ? [{ value: 'prompt', label: 'Prompt', badge: prompts[id === '1b' ? '1' : id] || prompts[id] ? <span className="size-1.5 rounded-full bg-accent-2" aria-label="edited" /> : undefined }] : []),
    ...(hasModel ? [{ value: 'model', label: 'Model' }] : []),
    { value: 'output', label: 'Output' },
    { value: 'runs', label: 'Runs', badge: runs.length ? <span className="rounded-full bg-surface-3 px-1.5 text-[10.5px] text-ink-2">{runs.length}</span> : undefined },
  ]
  const current = tabs.some(t => t.value === tab) ? tab : 'overview'
  const busy = runningStage === id

  return (
    <section aria-label={`Stage ${id} inspector`} className="flex h-full min-w-0 flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="grid size-10 place-items-center rounded-xl bg-gradient-accent text-white shadow-[0_6px_20px_-8px_var(--accent)]"><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-ink-3">Stage {id}</span>
            <Badge tone={st.kind === 'deterministic' ? 'teal' : st.kind === 'llm' || st.kind === 'vlm' ? 'accent' : 'neutral'}>{KIND_LABEL[st.kind]}</Badge>
            <StatusIcon status={status} />
          </div>
          <h1 className="truncate text-[17px] font-semibold tracking-tight text-ink">{st.name}</h1>
        </div>
        {RUNNABLE.includes(id) && (
          <div className="flex items-center gap-2">
            {id !== '7' && id !== '5' && (
              <Tip label="Run this stage and every stage after it">
                <Button size="sm" variant="ghost" icon={<SkipForward className="size-3.5" />} disabled={running} onClick={() => runPipeline(id)}>Run from here</Button>
              </Tip>
            )}
            <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} loading={busy} disabled={running && !busy}
              onClick={() => { set({ tab: 'output' }); runStage(id) }} data-testid="run-stage">
              {id === '5' ? 'Validate' : id === '7' ? 'Apply edit' : 'Run stage'}
            </Button>
          </div>
        )}
      </header>

      <Tabs value={current} onChange={v => set({ tab: v })} tabs={tabs} className="flex-1">
        <TabPanel value="overview" className="p-5"><Overview id={id} runs={runs} /></TabPanel>
        <TabPanel value="input" className="p-5"><StageInput id={id} /></TabPanel>
        {hasPrompt && <TabPanel value="prompt" className="p-5"><PromptEditor id={id} /></TabPanel>}
        {hasModel && <TabPanel value="model" className="p-5"><ModelPanel id={id} /></TabPanel>}
        <TabPanel value="output" className="p-5"><StageOutput id={id} /></TabPanel>
        <TabPanel value="runs" className="p-5"><RunHistory runs={runs} /></TabPanel>
      </Tabs>
    </section>
  )
}

function Overview({ id, runs }: { id: StageId; runs: Run[] }) {
  const st = stageById(id), last = runs[0]
  const hasModel = MODEL_STAGES.includes(id)
  useRuntime(s => s.installed)
  return (
    <div className="max-w-3xl space-y-6 animate-in">
      <p className="text-[15px] leading-relaxed text-ink">{st.purpose}</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] items-stretch">
        <div className="rounded-xl border border-border bg-surface p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Consumes</div>
          <div className="mt-1 text-[13.5px] text-ink">{st.consumes}</div>
        </div>
        <div className="hidden sm:grid place-items-center text-ink-3"><ArrowRight className="size-4" /></div>
        <div className="rounded-xl border border-border bg-surface p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Produces</div>
          <div className="mt-1 text-[13.5px] text-ink">{st.produces}</div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3"><Cpu className="size-3.5" /> Model</div>
          <div className="mt-1 text-[13.5px] text-ink">{st.modelClass}</div>
          {hasModel && <div className="mt-1 font-mono text-[12px] text-accent">{resolveModel(id)}</div>}
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{st.why}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Guardrails</div>
          <ul className="mt-1.5 space-y-1.5">
            {st.checks.map(c => <li key={c} className="flex gap-2 text-[13px] text-ink-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-accent" />{c}</li>)}
          </ul>
        </div>
      </div>
      {last && (
        <div className="rounded-xl border border-border bg-surface p-3.5">
          <SectionTitle>Last run</SectionTitle>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-2">
            <span className={last.ok ? 'text-success' : 'text-danger'}>{last.ok ? 'Succeeded' : last.error?.title ?? 'Failed'}</span>
            {last.model && <span className="font-mono text-[12px]">{last.model}</span>}
            {last.meta && <span className="num">{(last.meta.ms / 1000).toFixed(1)} s</span>}
            {last.meta?.evalTokens ? <span className="num">{last.meta.evalTokens} tokens{last.meta.tokPerSec ? ` · ${last.meta.tokPerSec} tok/s` : ''}</span> : null}
            <span>{new Date(last.ts).toLocaleTimeString()}</span>
          </div>
          {last.notes?.length ? <ul className="mt-2 space-y-0.5 text-[12.5px] text-ink-3">{last.notes.map(n => <li key={n}>· {n}</li>)}</ul> : null}
        </div>
      )}
    </div>
  )
}

function PromptEditor({ id }: { id: StageId }) {
  const key = id === '1b' ? '1' : id
  const override = useStudio(s => s.prompts[key]), prompts = useStudio(s => s.prompts), set = useStudio(s => s.set)
  const partType = useStudio(s => s.partType), machine = useStudio(s => s.common.machine_id)
  useStudio(s => s.feedback)
  const reg = useRuntime(s => s.registry)
  const template = override ?? DEFAULT_PROMPTS[key] ?? ''
  const vars = useMemo(() => promptVars(id, { reg, type: partType, machineId: String(machine) }), [id, reg, partType, machine])
  const used = templateVars(template)
  const filled = systemPrompt(id).filled
  const edited = override !== undefined && override !== DEFAULT_PROMPTS[key]

  return (
    <div className="space-y-5 animate-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold text-ink">System prompt template</h2>
          {edited ? <Badge tone="violet">Edited this session</Badge> : <Badge>Default</Badge>}
          {id === '1b' && <Badge>Shared with Stage 1</Badge>}
        </div>
        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} disabled={!edited}
          onClick={() => { const p = { ...prompts }; delete p[key]; set({ prompts: p }) }}>Reset to default</Button>
      </div>
      <Textarea value={template} spellCheck={false} onChange={e => set({ prompts: { ...prompts, [key]: e.target.value } })}
        className="min-h-64 font-mono text-[12.5px] leading-[1.7]" aria-label="System prompt template" data-testid="prompt-editor" />
      <div>
        <SectionTitle>Variables</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(vars).filter(([k]) => used.includes(k)).map(([k, v]) => (
            <Tip key={k} label={<span className="font-mono">{v || '(empty)'}</span>}>
              <span className="inline-flex h-6 items-center rounded-md border border-accent/30 bg-accent-soft px-2 font-mono text-[11.5px] text-accent cursor-help">{`{{${k}}}`}</span>
            </Tip>
          ))}
          {used.filter(k => !(k in vars)).map(k => <span key={k} className="inline-flex h-6 items-center rounded-md bg-danger-soft px-2 font-mono text-[11.5px] text-danger">{`{{${k}}}`} unknown</span>)}
          {!used.length && <span className="text-[12.5px] text-ink-3">This template has no variables.</span>}
        </div>
        <p className="mt-2 text-[12px] text-ink-3">Variables are filled from the registry, the selected machine and the standards file at run time. Edits persist for this browser session only.</p>
      </div>
      <CodeBlock title="Filled prompt · exactly what the model receives" code={filled} maxH="max-h-96" />
    </div>
  )
}

function ModelPanel({ id }: { id: StageId }) {
  const installed = useRuntime(s => s.installed), models = useStudio(s => s.models), temps = useStudio(s => s.temps), set = useStudio(s => s.set)
  const st = stageById(id), current = resolveModel(id)
  const isInstalled = installed.some(m => m === current)
  const options = [...new Set([current, ...installed, ...(st.recommendedModel ? [st.recommendedModel] : [])])]
  const temp = temps[id] ?? (id === '3' ? 0.4 : 0.1)
  return (
    <div className="max-w-2xl space-y-6 animate-in">
      <div>
        <SectionTitle>Model</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="Model" value={current} onChange={v => set({ models: { ...models, [id]: v } })} className="min-w-64 font-mono text-[12.5px]"
            options={options.map(m => ({ value: m, label: `${m}${installed.includes(m) ? '' : '  (not installed)'}${m === st.recommendedModel ? '  · recommended' : ''}` }))} />
          {models[id] && <Button size="sm" variant="ghost" onClick={() => { const m = { ...models }; delete m[id]; set({ models: m }) }}>Use automatic</Button>}
        </div>
        {!isInstalled && installed.length > 0 && (
          <div className="mt-3"><CodeBlock title="Not installed — pull it with" code={`ollama pull ${current}`} maxH="max-h-20" /></div>
        )}
        {installed.length === 0 && <p className="mt-2 text-[12.5px] text-warning">No local models detected. Is Ollama running?</p>}
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2"><span className="text-ink-3">Recommended:</span> <span className="font-mono">{st.recommendedModel ?? '—'}</span> — {st.why}</p>
      </div>
      {id !== '2' && (
        <div>
          <SectionTitle right={<span className="num font-mono text-[12px] text-ink-2">{temp.toFixed(2)}</span>}>Temperature</SectionTitle>
          <input type="range" min={0} max={1} step={0.05} value={temp} onChange={e => set({ temps: { ...temps, [id]: +e.target.value } })} className="w-full accent-[var(--accent)]" aria-label="Temperature" />
          <div className="mt-1 flex justify-between text-[11.5px] text-ink-3"><span>Deterministic extraction</span><span>Exploratory design</span></div>
        </div>
      )}
      <div className="rounded-xl border border-border bg-surface p-3.5 text-[12.5px] leading-relaxed text-ink-2">
        <div className="font-semibold text-ink">Call settings</div>
        <ul className="mt-1.5 space-y-1">
          <li>· Runs on local Ollama through the backend proxy — nothing leaves the network.</li>
          <li>· {['1', '1b', '3', '7'].includes(id) ? 'JSON mode on (format: "json").' : id === '2' ? 'Embeddings endpoint; cosine similarity, jammed precedents weighted ×0.3.' : 'Free text; markdown fences are stripped.'}</li>
          <li>· Tokens stream live into the Output tab.</li>
        </ul>
      </div>
    </div>
  )
}

function RunHistory({ runs }: { runs: Run[] }) {
  const [open, setOpen] = useState<string | null>(runs[0]?.id ?? null)
  if (!runs.length) return <p className="text-[13px] text-ink-3">No runs yet in this session.</p>
  return (
    <ol className="max-w-4xl space-y-2 animate-in">
      {runs.map((r, i) => {
        const prev = runs[i + 1], isOpen = open === r.id
        return (
          <li key={r.id} className="rounded-xl border border-border bg-surface">
            <button onClick={() => setOpen(isOpen ? null : r.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left cursor-pointer">
              {isOpen ? <ChevronDown className="size-4 text-ink-3" /> : <ChevronRight className="size-4 text-ink-3" />}
              <span className={cn('size-2 rounded-full', r.ok ? 'bg-success' : 'bg-danger')} />
              <span className="text-[13px] font-medium text-ink">{r.ok ? 'Succeeded' : r.error?.title ?? 'Failed'}</span>
              {r.iteration && r.iteration > 1 && <Badge tone="warning">loop #{r.iteration}</Badge>}
              <span className="font-mono text-[11.5px] text-ink-3">{r.model}</span>
              <span className="ml-auto flex items-center gap-3 text-[12px] text-ink-3">
                {r.meta && <span className="num">{(r.meta.ms / 1000).toFixed(1)}s</span>}
                <span className="flex items-center gap-1"><Clock className="size-3" />{new Date(r.ts).toLocaleTimeString()}</span>
              </span>
            </button>
            {isOpen && (
              <div className="space-y-3 border-t border-border p-3.5">
                {r.error && <div className="rounded-lg bg-danger-soft p-2.5 text-[12.5px] text-danger">{r.error.detail}{r.error.hint && <div className="mt-1 font-mono text-ink-2">{r.error.hint}</div>}</div>}
                {r.notes?.length ? <ul className="text-[12.5px] text-ink-2">{r.notes.map(n => <li key={n}>· {n}</li>)}</ul> : null}
                {r.system && <CodeBlock title="System" code={r.system} maxH="max-h-48" />}
                {r.user && <CodeBlock title="Input" code={r.user} maxH="max-h-48" />}
                {r.output !== undefined && <CodeBlock title="Output" code={r.output} maxH="max-h-64" />}
                {prev?.output && r.output && prev.output !== r.output && <Diff a={prev.output} b={r.output} />}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Line diff against the previous run (LCS), so an engineer sees what a prompt edit changed. */
function Diff({ a, b }: { a: string; b: string }) {
  const rows = useMemo(() => {
    const A = pretty(a).split('\n'), B = pretty(b).split('\n')
    if (A.length * B.length > 250000) return null
    const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1))
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    const out: { t: ' ' | '+' | '-'; s: string }[] = []
    let i = 0, j = 0
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { out.push({ t: ' ', s: A[i] }); i++; j++ }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', s: A[i++] })
      else out.push({ t: '+', s: B[j++] })
    }
    while (i < A.length) out.push({ t: '-', s: A[i++] })
    while (j < B.length) out.push({ t: '+', s: B[j++] })
    return out
  }, [a, b])
  if (!rows) return null
  return (
    <div className="rounded-lg border border-border bg-bg">
      <div className="border-b border-border px-3 py-1.5 text-[11.5px] font-medium text-ink-3">Diff vs previous run</div>
      <pre className="max-h-64 overflow-auto p-2 font-mono text-[11.5px] leading-[1.6]">
        {rows.map((r, k) => (
          <div key={k} className={r.t === '+' ? 'bg-success-soft text-success' : r.t === '-' ? 'bg-danger-soft text-danger' : 'text-ink-3'}>{r.t} {r.s}</div>
        ))}
      </pre>
    </div>
  )
}
const pretty = (t: string) => { try { return JSON.stringify(JSON.parse(t), null, 2) } catch { return t } }

