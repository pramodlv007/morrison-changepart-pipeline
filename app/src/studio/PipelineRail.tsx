/** Left rail: the pipeline as a vertical graph with live status, latency and feedback edges. */
import { Brain, ChartLine, CircleCheck, CircleX, Code, Database, FileText, LoaderCircle, ScanEye, Send, ShieldCheck, TriangleAlert, Wand } from 'lucide-react'
import { STAGES, type StageId, type StageKind } from '@/core/pipeline'
import { useRuntime, useStudio, type Status } from './store'
import { cn } from '@/ui/primitives'

export const STAGE_ICON: Record<StageId, typeof Brain> = {
  '1': FileText, '1b': ScanEye, '2': Database, '3': Brain, '4': Code, '5': ShieldCheck, '6': Send, '7': Wand, '8': ChartLine,
}
export const KIND_LABEL: Record<StageKind, string> = {
  llm: 'LLM', vlm: 'Vision', embedding: 'Embedding', deterministic: 'Deterministic', viewer: 'Hand-off', ml: 'Offline ML',
}

export function StatusIcon({ status, className }: { status: Status | undefined; className?: string }) {
  if (status === 'running') return <LoaderCircle className={cn('size-4 animate-spin text-accent', className)} aria-label="running" />
  if (status === 'done') return <CircleCheck className={cn('size-4 text-success', className)} aria-label="done" />
  if (status === 'error') return <CircleX className={cn('size-4 text-danger', className)} aria-label="failed" />
  if (status === 'blocked') return <TriangleAlert className={cn('size-4 text-warning', className)} aria-label="blocked" />
  if (status === 'stale') return <span className={cn('grid size-4 place-items-center', className)} aria-label="queued"><span className="size-2 rounded-full bg-warning/70 animate-pulse-dot" /></span>
  return <span className={cn('grid size-4 place-items-center', className)} aria-label="not run"><span className="size-2.5 rounded-full border-[1.5px] border-ink-3" /></span>
}

const GROUPS: { title: string; ids: StageId[] }[] = [
  { title: 'Understand', ids: ['1', '1b', '2'] },
  { title: 'Design', ids: ['3', '4', '5'] },
  { title: 'Deliver', ids: ['6', '7', '8'] },
]

export function PipelineRail() {
  const selected = useStudio(s => s.selected), status = useStudio(s => s.status), runs = useStudio(s => s.runs)
  const loop = useStudio(s => s.loop.history), set = useStudio(s => s.set)
  const runningStage = useRuntime(s => s.runningStage)
  const loops = loop.filter(l => l.route !== 'none')

  return (
    <nav aria-label="Pipeline stages" className="flex h-full flex-col overflow-y-auto border-r border-border bg-surface px-3 py-4 max-lg:px-2">
      {GROUPS.map(g => (
        <div key={g.title} className="mb-4">
          <div className="mb-1.5 px-2 max-lg:hidden text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-3">{g.title}</div>
          <ol className="relative space-y-0.5">
            {g.ids.map(id => {
              const st = STAGES.find(s => s.id === id)!, Icon = STAGE_ICON[id], last = runs[id]?.[0]
              const active = selected === id, live = runningStage === id
              return (
                <li key={id}>
                  <button onClick={() => set({ selected: id })} data-stage={id} aria-current={active ? 'step' : undefined}
                    className={cn('group relative flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition cursor-pointer',
                      active ? 'bg-accent-soft' : 'hover:bg-surface-2')}>
                    {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" />}
                    <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg border transition',
                      active ? 'border-accent/40 bg-accent/15 text-accent' : 'border-border bg-surface-2 text-ink-2 group-hover:text-ink',
                      live && 'ring-2 ring-accent/50')}>
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 max-lg:hidden">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-ink-3">{id}</span>
                        <span className={cn('truncate text-[13px] font-medium', active ? 'text-ink' : 'text-ink-2 group-hover:text-ink')}>{st.name}</span>
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-3">
                        {live ? 'Running…' : last?.meta ? `${KIND_LABEL[st.kind]} · ${(last.meta.ms / 1000).toFixed(1)}s` : KIND_LABEL[st.kind]}
                      </span>
                    </span>
                    <StatusIcon status={status[id]} className="max-lg:absolute max-lg:right-0 max-lg:top-0" />
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      ))}

      <div className="mt-auto max-lg:hidden rounded-lg border border-border bg-surface-2/50 p-3">
        <div className="text-[11.5px] font-semibold text-ink-2">Feedback loop</div>
        <div className="mt-1 text-[11.5px] leading-relaxed text-ink-3">Stage 5 rejects route back: geometry → Stage 3, spec conflicts → Stage 1.</div>
        {loops.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {loop.map(l => (
              <span key={l.ts} className={cn('rounded px-1.5 py-0.5 font-mono text-[10.5px]', l.verdict === 'accept' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
                #{l.iteration} {l.verdict === 'accept' ? '✓' : `→${l.route === 'stage1' ? '1' : '3'}`}
              </span>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
