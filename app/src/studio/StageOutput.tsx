/** Output tab: live token stream while running, then a structured view of what the stage produced. */
import { useEffect, useState } from 'react'
import { CircleCheck, CircleX, Download, ExternalLink, FlaskConical, MessageSquare, RefreshCw, Send, Sparkles, TriangleAlert } from 'lucide-react'
import type { StageId } from '@/core/pipeline'
import { validateDesign } from '@/core/validate'
import { downloadStep, getDesign, type DesignRecord } from '@/core/backend'
import { useDesign, useRuntime, useStudio } from './store'
import { publish } from './runner'
import { Scorecard, VerdictPill } from './Scorecard'
import { Badge, Button, cn, CodeBlock, CopyButton, EmptyState, SectionTitle } from '@/ui/primitives'
import { toast } from '@/ui/overlay'

export function StageOutput({ id }: { id: StageId }) {
  const live = useRuntime(r => r.runningStage === id), stream = useRuntime(r => r.streams[id])
  const last = useStudio(s => s.runs[id]?.[0])
  if (live && id !== '5' && id !== '2') {
    return (
      <div className="max-w-4xl space-y-3 animate-in">
        <div className="flex items-center gap-2 text-[13px] text-ink-2"><span className="size-2 rounded-full bg-accent animate-pulse-dot" /> Streaming from the local model… <span className="num font-mono text-ink-3">{stream?.length ?? 0} chars</span></div>
        <pre className="max-h-[560px] overflow-auto rounded-xl border border-border bg-bg p-4 font-mono text-[12px] leading-[1.7] text-ink-2 whitespace-pre-wrap" data-testid="stream">
          {stream || 'Waiting for the first token — the model may be loading into memory.'}<span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-accent animate-pulse-dot" />
        </pre>
      </div>
    )
  }
  return (
    <div className="max-w-4xl space-y-5 animate-in">
      {last?.error && (
        <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger-soft p-3.5">
          <CircleX className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0 text-[13px]">
            <div className="font-semibold text-danger">{last.error.title}</div>
            <div className="mt-0.5 text-ink-2 break-words">{last.error.detail}</div>
            {last.error.hint && <code className="mt-1.5 inline-block rounded bg-bg px-2 py-0.5 font-mono text-[12px] text-ink">{last.error.hint}</code>}
          </div>
        </div>
      )}
      <Body id={id} />
      {last?.notes?.length && id !== '5' ? (
        <div>
          <SectionTitle>Checks on this output</SectionTitle>
          <ul className="space-y-1">{last.notes.map(n => <li key={n} className={cn('text-[12.5px]', /FAIL|DRIFT|not found|failed|not registered|not a clean/i.test(n) ? 'text-warning' : 'text-ink-2')}>· {n}</li>)}</ul>
        </div>
      ) : null}
      {last?.output && !['5', '2'].includes(id) && (
        <details className="group">
          <summary className="cursor-pointer text-[12.5px] font-medium text-ink-3 hover:text-ink">Raw model output</summary>
          <div className="mt-2"><CodeBlock code={last.output} maxH="max-h-96" /></div>
        </details>
      )}
    </div>
  )
}

function Body({ id }: { id: StageId }) {
  const spec = useStudio(s => s.spec), grounding = useStudio(s => s.grounding), ranked = useStudio(s => s.ranked)
  const branches = useStudio(s => s.branches), picked = useStudio(s => s.pickedBranch), cad = useStudio(s => s.cad)
  const loadDesign = useStudio(s => s.loadDesign), set = useStudio(s => s.set), refine = useStudio(s => s.refine)
  const reg = useRuntime(r => r.registry), design = useDesign()
  const label = reg.parts[design.part_type]?.label ?? design.part_type

  if (id === '1' || id === '1b') {
    if (!spec) return <EmptyState icon={<Sparkles className="size-5" />} title="No spec yet" body="Run Stage 1 to extract a structured spec from the customer request." />
    const rows = Object.entries(spec).filter(([k, v]) => k !== 'unresolved_questions' && v !== null && v !== undefined && v !== '')
    const nulls = Object.entries(spec).filter(([k, v]) => k !== 'unresolved_questions' && (v === null || v === undefined)).map(([k]) => k)
    return (
      <>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-ink-3"><tr><th className="px-3.5 py-2">Field</th><th className="px-3.5 py-2">Value</th><th className="px-3.5 py-2 text-right">Grounding</th></tr></thead>
            <tbody className="divide-y divide-border bg-surface">
              {rows.map(([k, v]) => {
                const flagged = grounding.some(g => g.startsWith(k + '='))
                return (
                  <tr key={k}>
                    <td className="px-3.5 py-2 font-mono text-[12px] text-ink-2">{k}</td>
                    <td className="px-3.5 py-2 font-mono text-[12.5px] text-ink">{String(v)}</td>
                    <td className="px-3.5 py-2 text-right">{typeof v === 'number' ? (flagged ? <Badge tone="warning">not in email</Badge> : <Badge tone="success">verbatim</Badge>) : null}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {nulls.length > 0 && <p className="text-[12px] text-ink-3">Left null (not stated): <span className="font-mono">{nulls.join(', ')}</span></p>}
        {spec.unresolved_questions?.length ? (
          <div className="rounded-xl border border-accent/25 bg-accent-soft p-3.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-accent"><MessageSquare className="size-3.5" /> Open questions for the customer</div>
            <ul className="space-y-1 text-[13px] text-ink">{spec.unresolved_questions.map(q => <li key={q}>· {q}</li>)}</ul>
          </div>
        ) : null}
      </>
    )
  }

  if (id === '2') {
    if (!ranked) return <EmptyState icon={<Sparkles className="size-5" />} title="Not ranked yet" body="Run Stage 2 to rank precedents by similarity and service outcome." />
    const max = Math.max(...ranked.map(r => r.score), 1e-6)
    return (
      <ol className="space-y-2">
        {ranked.map((r, i) => (
          <li key={r.id} className={cn('rounded-xl border bg-surface p-3.5', i === 0 ? 'border-accent/40' : 'border-border')}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-ink-3">#{i + 1}</span>
              <span className="font-mono text-[13px] font-semibold text-accent">{r.id}</span>
              <Badge tone={r.outcome === 'clean' ? 'success' : 'danger'}>{r.outcome}</Badge>
              <span className="ml-auto num font-mono text-[12px] text-ink-2">sim {r.sim.toFixed(3)} · weighted {r.score.toFixed(3)}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-gradient-accent" style={{ width: `${(r.score / max) * 100}%` }} /></div>
            <p className="mt-2 text-[12.5px] text-ink-2">{r.text}</p>
          </li>
        ))}
      </ol>
    )
  }

  if (id === '3') {
    if (!branches) return <EmptyState icon={<Sparkles className="size-5" />} title="No branches yet" body="Run Stage 3 to generate three candidate designs. Each one is gated by Stage 5 before selection." />
    return (
      <div className="grid gap-3 lg:grid-cols-3">
        {branches.map(b => {
          const bid = String(b.branch.branch_id ?? '?'), isPick = bid === picked
          return (
            <article key={bid} className={cn('flex flex-col rounded-xl border bg-surface p-3.5', isPick ? 'border-accent ring-2 ring-accent/25' : 'border-border')} data-branch={bid}>
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-surface-3 font-mono text-[13px] font-bold text-ink">{bid}</span>
                <VerdictPill card={b.card} size="sm" />
                {b.branch.recommended === true && <Badge tone="violet">model pick</Badge>}
                {isPick && <Badge tone="accent">in use</Badge>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                {(reg.parts[b.design.part_type]?.branchFields ?? []).map(k => (
                  <div key={k} className="contents"><dt className="truncate text-ink-3">{k.replace(/_mm$|_deg$/, '').replace(/_/g, ' ')}</dt><dd className="num text-right font-mono text-ink">{String(b.design[k] ?? '—')}</dd></div>
                ))}
              </dl>
              {b.branch.rationale && <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2 line-clamp-6">{String(b.branch.rationale)}</p>}
              {Array.isArray(b.branch.risk_flags) && b.branch.risk_flags.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[12px] text-warning">{b.branch.risk_flags.map((f: any) => <li key={String(f)}>⚑ {String(f)}</li>)}</ul>
              )}
              {!b.card.checks.every(c => c.pass) && <p className="mt-2 text-[12px] text-danger">{b.card.reasons[0]}</p>}
              <div className="mt-auto pt-3">
                <Button size="sm" variant={isPick ? 'secondary' : 'ghost'} disabled={isPick} className="w-full"
                  onClick={() => { loadDesign(b.design); set({ pickedBranch: bid }); toast.info(`Branch ${bid} loaded into the design panel`) }}>
                  {isPick ? 'Currently loaded' : 'Use this branch'}
                </Button>
              </div>
            </article>
          )
        })}
      </div>
    )
  }

  if (id === '4') return <CadOutput cad={cad} design={design} />
  if (id === '5') return <GateOutput design={design} label={label} />
  if (id === '6') return <PublishOutput />
  if (id === '7') {
    if (!refine?.delta) return <EmptyState icon={<Sparkles className="size-5" />} title="No edit applied yet" body="Write an instruction in the Input tab. The model returns a targeted delta; untouched fields must stay identical." />
    return (
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-ink-3"><tr><th className="px-3.5 py-2">Field</th><th className="px-3.5 py-2">New value</th></tr></thead>
          <tbody className="divide-y divide-border bg-surface">
            {Object.entries(refine.delta).map(([k, v]) => <tr key={k}><td className="px-3.5 py-2 font-mono text-[12px] text-ink-2">{k}</td><td className="px-3.5 py-2 font-mono text-accent-2">{String(v)}</td></tr>)}
          </tbody>
        </table>
      </div>
    )
  }
  // Stage 8
  const card = validateDesign(design)
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-border bg-surface p-4">
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-accent-3" />
        <div className="text-[13px] leading-relaxed text-ink-2">
          <div className="font-semibold text-ink">Offline model — not served in the browser</div>
          The jam-rate model is trained and compared in <span className="font-mono">stage8_model_comparison.ipynb</span> (gradient boosting). This view shows the exact feature vector it consumes, so no prediction is invented here.
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {Object.entries(card.computed).filter(([, v]) => v !== null).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-surface p-2.5">
            <div className="truncate text-[11px] text-ink-3">{k}</div>
            <div className="num font-mono text-[14px] text-ink">{String(v)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CadOutput({ cad, design }: { cad: { script: string; checks: { label: string; ok: boolean }[] } | null; design: any }) {
  const health = useRuntime(r => r.health)
  const [busy, setBusy] = useState(false)
  const step = async () => {
    setBusy(true)
    try { await downloadStep(design); toast.success('STEP downloaded', 'Built by the validated CadQuery builder, not by model code.') }
    catch (e: any) { toast.error('STEP export failed', e?.message) } finally { setBusy(false) }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" icon={<Download className="size-3.5" />} loading={busy} onClick={step} disabled={!health.cadquery}>Download STEP</Button>
        <span className="text-[12px] text-ink-3">{health.cadquery ? 'From the validated builder in stage5_engine.py — model code is reviewed, never executed.' : 'CadQuery is not installed on the backend (pip install cadquery).'}</span>
      </div>
      {!cad ? <EmptyState icon={<Sparkles className="size-5" />} title="No script yet" body="Run Stage 4 to have the code model write a CadQuery script for the current design." /> : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {cad.checks.map(c => <Badge key={c.label} tone={c.ok ? 'success' : 'danger'}>{c.ok ? <CircleCheck className="size-3" /> : <CircleX className="size-3" />}{c.label}</Badge>)}
          </div>
          <CodeBlock title="CadQuery script (Python)" code={cad.script} maxH="max-h-[520px]" lang="python" />
        </>
      )}
    </>
  )
}

function GateOutput({ design, label }: { design: any; label: string }) {
  const history = useStudio(s => s.loop.history), last = useStudio(s => s.runs['5']?.[0]), loop = useStudio(s => s.loop), set = useStudio(s => s.set)
  return (
    <>
      <Scorecard design={design} label={label} />
      {last?.notes && (
        <div className="flex flex-wrap gap-1.5">{last.notes.map(n => <Badge key={n} tone={/MISMATCH/.test(n) ? 'danger' : /not reachable/.test(n) ? 'neutral' : 'teal'}>{n}</Badge>)}</div>
      )}
      <div className="rounded-xl border border-border bg-surface p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-ink">Feedback loop</div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={loop.enabled} onChange={e => set({ loop: { ...loop, enabled: e.target.checked } })} className="accent-[var(--accent)]" /> Enabled
            <span className="text-ink-3">· max</span>
            <select value={loop.max} onChange={e => set({ loop: { ...loop, max: +e.target.value } })} className="rounded border border-border bg-surface-2 px-1 text-ink" aria-label="Max iterations">
              {[2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}
            </select>
            <span className="text-ink-3">iterations</span>
          </label>
        </div>
        {history.length === 0 ? <p className="mt-2 text-[12.5px] text-ink-3">Runs of the full pipeline appear here as a timeline of attempts.</p> : (
          <ol className="mt-3 space-y-2 border-l border-border pl-4">
            {history.map(h => (
              <li key={h.ts} className="relative">
                <span className={cn('absolute -left-[21px] top-1 size-2.5 rounded-full ring-4 ring-surface', h.verdict === 'accept' ? 'bg-success' : h.verdict === 'reject' ? 'bg-danger' : 'bg-warning')} />
                <div className="text-[13px] text-ink">Attempt {h.iteration} · <span className={h.verdict === 'accept' ? 'text-success' : 'text-danger'}>{h.verdict}</span>
                  {h.route !== 'none' && <span className="text-ink-3"> → {h.route === 'stage1' ? 'Stage 1 (spec conflict)' : 'Stage 3 (geometry)'}</span>}</div>
                {h.failing.length > 0 && <div className="text-[12px] text-ink-3">Failing: {h.failing.join(', ')}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  )
}

function PublishOutput() {
  const published = useStudio(s => s.published), spec = useStudio(s => s.spec)
  const design = useDesign(), card = validateDesign(design)
  const [busy, setBusy] = useState(false)
  const [record, setRecord] = useState<DesignRecord | null>(null)
  const load = async () => { if (published) try { setRecord(await getDesign(published.id)) } catch { /* offline */ } }
  useEffect(() => { load() }, [published?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => { setBusy(true); const url = await publish(); setBusy(false); if (url) { toast.success('Customer link ready', url); load() } }
  return (
    <>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <VerdictPill card={card} />
          <span className="text-[13px] text-ink-2">{card.verdict === 'accept' ? 'Validated — ready for customer review.' : 'Not accepted. You can still publish to ask the customer to resolve open questions.'}</span>
        </div>
        {spec?.unresolved_questions?.length ? <p className="mt-2 text-[12.5px] text-ink-3">{spec.unresolved_questions.length} open question(s) will be shown to the customer.</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="gradient" icon={<Send className="size-4" />} loading={busy} onClick={go} data-testid="publish">{published ? 'Update customer link' : 'Publish customer link'}</Button>
          {card.verdict !== 'accept' && <span className="flex items-center gap-1 text-[12px] text-warning"><TriangleAlert className="size-3.5" /> Publishing an unaccepted design</span>}
        </div>
        {published && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
            <code className="flex-1 truncate font-mono text-[12.5px] text-accent" data-testid="customer-link">{published.url}</code>
            <CopyButton text={published.url} />
            <a href={published.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-[11.5px] text-ink-3 hover:text-ink hover:bg-surface-3"><ExternalLink className="size-3.5" />Open</a>
          </div>
        )}
      </div>
      {published && (
        <div>
          <SectionTitle right={<Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={load}>Refresh</Button>}>Customer responses</SectionTitle>
          {!record?.responses.length ? <p className="text-[12.5px] text-ink-3">No response yet.</p> : (
            <ul className="space-y-2">{record.responses.map(r => <ResponseCard key={r.ts} r={r} />)}</ul>
          )}
        </div>
      )}
    </>
  )
}

export function ResponseCard({ r }: { r: DesignRecord['responses'][number] }) {
  const loadAdjust = useStudio(s => s.setParam), set = useStudio(s => s.set)
  const adj = Object.entries(r.adjustments ?? {})
  return (
    <li className="rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <Badge tone={r.kind === 'approve' ? 'success' : 'warning'}>{r.kind === 'approve' ? 'Approved' : 'Changes requested'}</Badge>
        <span className="text-[12px] text-ink-3">{new Date(r.ts).toLocaleString()}</span>
      </div>
      {r.text && <p className="mt-2 text-[13px] text-ink">{r.text}</p>}
      {r.answers?.length ? <ul className="mt-2 space-y-1 text-[12.5px] text-ink-2">{r.answers.map(a => <li key={a.q}><span className="text-ink-3">{a.q}</span> — {a.a}</li>)}</ul> : null}
      {adj.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {adj.map(([k, v]) => <Badge key={k} tone="violet">{k} → {String(v)}</Badge>)}
          <Button size="sm" variant="secondary" onClick={() => { adj.forEach(([k, v]) => loadAdjust(k, v)); toast.success('Customer adjustments applied', 'Re-validate in Stage 5.') }}>Apply to design</Button>
        </div>
      )}
      {r.kind === 'request' && r.text && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ refine: { instruction: r.text, delta: null, drift: [], ignored: [] }, selected: '7', tab: 'input' })}>Send to Stage 7 refinement</Button>
      )}
    </li>
  )
}
