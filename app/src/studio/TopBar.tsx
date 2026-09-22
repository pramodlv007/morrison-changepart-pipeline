import { useEffect, useState } from 'react'
import { Command as Cmd } from 'cmdk'
import { Activity, Boxes, Hexagon, Inbox, Play, RefreshCw, Search, Square, Trash2, Workflow } from 'lucide-react'
import { STAGES, type StageId } from '@/core/pipeline'
import { APP_NAME } from '@/core/app'
import { listDesigns, listRequests, type CustomerRequest, type DesignRecord } from '@/core/backend'
import { useRuntime, useStudio } from './store'
import { refreshEnvironment, runPipeline, runStage, stopPipeline, publish } from './runner'
import { ResponseCard } from './StageOutput'
import { Badge, Button, cn, IconButton, Kbd, NativeSelect, Segmented, Tip } from '@/ui/primitives'
import { Dialog, Sheet, toast } from '@/ui/overlay'

function HealthPill({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <Tip label={detail}>
      <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium',
        ok ? 'border-border text-ink-2' : 'border-danger/40 bg-danger-soft text-danger')} data-health={label}>
        <span className={cn('size-1.5 rounded-full', ok ? 'bg-success' : 'bg-danger')} />{label}
      </span>
    </Tip>
  )
}

export function TopBar() {
  const partType = useStudio(s => s.partType), setPartType = useStudio(s => s.setPartType), view = useStudio(s => s.view), set = useStudio(s => s.set)
  const reg = useRuntime(r => r.registry), health = useRuntime(r => r.health), installed = useRuntime(r => r.installed), running = useRuntime(r => r.running)
  const [cmd, setCmd] = useState(false), [inbox, setInbox] = useState(false), [log, setLog] = useState(false), [reset, setReset] = useState(false)
  const [pending, setPending] = useState(0)

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd(v => !v) }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (!useRuntime.getState().running) runStage(useStudio.getState().selected) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  useEffect(() => {
    const poll = async () => {
      try {
        const [d, r] = await Promise.all([listDesigns(), listRequests()])
        setPending(d.reduce((n, x) => n + x.responses.length, 0) + r.length)
      } catch { /* backend down */ }
    }
    poll(); const t = setInterval(poll, 15000)
    return () => clearInterval(t)
  }, [])

  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex items-center gap-2 pr-1">
        <span className="grid size-7 place-items-center rounded-lg bg-gradient-accent text-white"><Hexagon className="size-4" strokeWidth={2.4} /></span>
        <span className="text-[14px] font-semibold tracking-tight text-ink max-md:hidden">{APP_NAME}</span>
      </div>
      <span className="h-5 w-px bg-border" />
      <NativeSelect aria-label="Part type" value={partType} onChange={v => { setPartType(v, reg); set({ baseline: null }) }} className="h-8 min-w-44"
        options={Object.values(reg.parts).map(p => ({ value: p.key, label: p.label }))} />
      <Segmented label="Workspace" size="sm" value={view} onChange={v => set({ view: v })}
        options={[{ value: 'pipeline', label: 'Pipeline', icon: <Workflow className="size-3.5" /> }, { value: 'cad', label: 'CAD', icon: <Boxes className="size-3.5" /> }]} />

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-1.5 max-xl:hidden">
          <HealthPill ok={health.ollama} label={health.ollama ? `Ollama · ${installed.length}` : 'Ollama'} detail={health.ollama ? `Local models: ${installed.join(', ')}` : 'Ollama is not reachable — start it, then refresh.'} />
          <HealthPill ok={health.backend} label="Backend" detail={health.backend ? 'serve.py is up: registry, Python Stage 5, STEP, hand-off store' : 'Backend not reachable — run: python serve.py'} />
          <HealthPill ok={health.cadquery} label="CadQuery" detail={health.cadquery ? 'STEP export available' : 'STEP export needs: pip install cadquery'} />
          <IconButton size="sm" label="Re-check services" onClick={() => refreshEnvironment().then(() => toast.info('Services re-checked'))}><RefreshCw className="size-3.5" /></IconButton>
        </div>
        <button onClick={() => setCmd(true)} className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-[12.5px] text-ink-3 hover:text-ink cursor-pointer" aria-label="Open command menu">
          <Search className="size-3.5" /><span className="max-lg:hidden">Commands</span><Kbd>Ctrl K</Kbd>
        </button>
        <IconButton size="sm" label="Activity log" onClick={() => setLog(true)}><Activity className="size-4" /></IconButton>
        <div className="relative">
          <IconButton size="sm" label="Customer inbox" onClick={() => setInbox(true)}><Inbox className="size-4" /></IconButton>
          {pending > 0 && <span className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-2 px-1 text-[10px] font-bold text-white">{pending}</span>}
        </div>
        <IconButton size="sm" label="Reset session" onClick={() => setReset(true)}><Trash2 className="size-4" /></IconButton>
        {running
          ? <Button size="sm" variant="danger" icon={<Square className="size-3.5" />} onClick={stopPipeline} data-testid="stop">Stop</Button>
          : <Button size="sm" variant="gradient" icon={<Play className="size-3.5" />} onClick={() => runPipeline('1')} data-testid="run-all">Run pipeline</Button>}
      </div>

      <CommandMenu open={cmd} onOpenChange={setCmd} openInbox={() => setInbox(true)} />
      <InboxSheet open={inbox} onOpenChange={setInbox} />
      <ActivitySheet open={log} onOpenChange={setLog} />
      <Dialog open={reset} onOpenChange={setReset} title="Reset this session?" description="Clears inputs, outputs, run history and prompt edits stored in this tab. Published customer links are not affected."
        footer={<><Button variant="ghost" onClick={() => setReset(false)}>Cancel</Button><Button variant="danger" onClick={() => { useStudio.getState().resetSession(); setReset(false); toast.info('Session reset') }}>Reset</Button></>}>
        <p className="text-[13px] text-ink-2">This cannot be undone.</p>
      </Dialog>
    </header>
  )
}

function CommandMenu({ open, onOpenChange, openInbox }: { open: boolean; onOpenChange: (o: boolean) => void; openInbox: () => void }) {
  const set = useStudio(s => s.set), setPartType = useStudio(s => s.setPartType), reg = useRuntime(r => r.registry)
  const go = (fn: () => void) => { onOpenChange(false); fn() }
  const item = 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-ink-2 cursor-pointer data-[selected=true]:bg-accent-soft data-[selected=true]:text-ink'
  const group = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-3'
  return (
    <Cmd.Dialog open={open} onOpenChange={onOpenChange} label="Command menu"
      overlayClassName="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-[14vh] z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl animate-in">
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search className="size-4 text-ink-3" />
        <Cmd.Input placeholder="Run a stage, jump to one, switch part…" className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3" />
      </div>
      <Cmd.List className="max-h-[420px] overflow-y-auto p-2">
        <Cmd.Empty className="px-3 py-6 text-center text-[13px] text-ink-3">No matching command.</Cmd.Empty>
        <Cmd.Group heading="Pipeline" className={group}>
          <Cmd.Item className={item} onSelect={() => go(() => runPipeline('1'))}><Play className="size-4" /> Run full pipeline</Cmd.Item>
          <Cmd.Item className={item} onSelect={() => go(() => runStage('5'))}>Validate current design (Stage 5)</Cmd.Item>
          <Cmd.Item className={item} onSelect={() => go(() => { publish().then(u => u && toast.success('Customer link ready', u)) })}>Publish customer link</Cmd.Item>
          <Cmd.Item className={item} onSelect={() => go(openInbox)}>Open customer inbox</Cmd.Item>
        </Cmd.Group>
        <Cmd.Group heading="Go to stage" className={group}>
          {STAGES.map(s => (
            <Cmd.Item key={s.id} value={`go stage ${s.id} ${s.name}`} className={item} onSelect={() => go(() => set({ selected: s.id as StageId, view: 'pipeline' }))}>
              <span className="w-6 font-mono text-[11.5px] text-ink-3">{s.id}</span>{s.name}
            </Cmd.Item>
          ))}
        </Cmd.Group>
        <Cmd.Group heading="Part type" className={group}>
          {Object.values(reg.parts).map(p => (
            <Cmd.Item key={p.key} value={`part ${p.label}`} className={item} onSelect={() => go(() => { setPartType(p.key, reg); set({ baseline: null }) })}>Switch to {p.label}</Cmd.Item>
          ))}
        </Cmd.Group>
        <Cmd.Group heading="View" className={group}>
          <Cmd.Item className={item} onSelect={() => go(() => set({ view: 'pipeline' }))}>Pipeline workspace</Cmd.Item>
          <Cmd.Item className={item} onSelect={() => go(() => set({ view: 'cad' }))}>CAD workspace</Cmd.Item>
        </Cmd.Group>
      </Cmd.List>
    </Cmd.Dialog>
  )
}

function InboxSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [designs, setDesigns] = useState<DesignRecord[] | null>(null), [requests, setRequests] = useState<CustomerRequest[] | null>(null)
  const set = useStudio(s => s.set), setPartType = useStudio(s => s.setPartType), reg = useRuntime(r => r.registry)
  const load = async () => {
    try { const [d, r] = await Promise.all([listDesigns(), listRequests()]); setDesigns(d); setRequests(r) }
    catch { setDesigns([]); setRequests([]); toast.error('Inbox unavailable', 'The backend is not reachable.') }
  }
  useEffect(() => { if (open) load() }, [open])
  const toEmail = (r: CustomerRequest) => [`From: ${r.contact}${r.company ? ` (${r.company})` : ''}`, `Subject: New ${reg.parts[r.part_type]?.label ?? r.part_type} request`, '',
    ...Object.entries(r.details).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`), '', r.notes].join('\n')
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Customer inbox" description="New requests from the portal and responses to published designs." width="w-[min(520px,100vw)]">
      <div className="space-y-6 p-5">
        <section>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[13px] font-semibold text-ink">New requests</h3><Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={load}>Refresh</Button></div>
          {!requests?.length ? <p className="text-[12.5px] text-ink-3">No new requests.</p> : (
            <ul className="space-y-2">
              {[...requests].reverse().map(r => (
                <li key={r.id} className="rounded-xl border border-border bg-surface-2/40 p-3.5">
                  <div className="flex items-center gap-2"><Badge tone="accent">{reg.parts[r.part_type]?.label ?? r.part_type}</Badge><span className="text-[12px] text-ink-3">{new Date(r.ts).toLocaleString()}</span></div>
                  <div className="mt-1.5 text-[13px] text-ink">{r.contact}{r.company && <span className="text-ink-3"> · {r.company}</span>}</div>
                  {r.notes && <p className="mt-1 text-[12.5px] text-ink-2 line-clamp-3">{r.notes}</p>}
                  <Button size="sm" variant="secondary" className="mt-2" onClick={() => {
                    if (reg.parts[r.part_type]) setPartType(r.part_type, reg)
                    set({ email: toEmail(r), selected: '1', tab: 'input', view: 'pipeline' }); onOpenChange(false); toast.info('Loaded into Stage 1')
                  }}>Load into Stage 1</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">Published designs</h3>
          {!designs?.length ? <p className="text-[12.5px] text-ink-3">Nothing published yet.</p> : (
            <ul className="space-y-3">
              {[...designs].reverse().map(d => (
                <li key={d.id} className="rounded-xl border border-border p-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{d.payload.label}</span>
                    <span className="font-mono text-[11.5px] text-ink-3">{d.id}</span>
                    <a className="ml-auto text-[12px] text-accent hover:underline" href={`/customer?d=${d.id}`} target="_blank" rel="noreferrer">Open</a>
                  </div>
                  {d.responses.length ? <ul className="mt-2 space-y-2">{d.responses.map(r => <ResponseCard key={r.ts} r={r} />)}</ul> : <p className="mt-1 text-[12px] text-ink-3">Awaiting customer.</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  )
}

function ActivitySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const trace = useStudio(s => s.trace), set = useStudio(s => s.set)
  const color = { info: 'text-ink-2', ok: 'text-success', warn: 'text-warning', error: 'text-danger' }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Activity" description="Everything the pipeline did in this session.">
      <div className="p-4">
        {!trace.length ? <p className="text-[12.5px] text-ink-3">Nothing yet.</p> : (
          <ol className="space-y-1 font-mono text-[11.5px]">
            {[...trace].reverse().map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-ink-3">{new Date(t.ts).toLocaleTimeString()}</span>
                <button className="w-8 shrink-0 text-left text-accent hover:underline cursor-pointer" onClick={() => t.stage !== 'sys' && set({ selected: t.stage, view: 'pipeline' })}>{t.stage === 'sys' ? '—' : t.stage}</button>
                <span className={color[t.level]}>{t.msg}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Sheet>
  )
}
