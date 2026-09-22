/** Input tab: what each stage consumes, and where it came from. */
import { useMemo, useState } from 'react'
import { ImagePlus, Link2, Mail, Play } from 'lucide-react'
import type { StageId } from '@/core/pipeline'
import { validateDesign } from '@/core/validate'
import { useDesign, useRuntime, useStudio } from './store'
import { customerPayload, runStage, userInput } from './runner'
import { Badge, Button, CodeBlock, NativeSelect, SectionTitle, Textarea } from '@/ui/primitives'

const SOURCE: Partial<Record<StageId, string>> = {
  '1': 'Customer email (paste, pick a sample, or load from the customer inbox)',
  '1b': 'Uploaded drawing or photo',
  '2': 'Stage 1 spec → one-line summary',
  '3': 'Stage 1 spec + Stage 2 ranked precedents (+ Stage 5 feedback when looping)',
  '4': 'The chosen Stage 3 branch as it stands in the design panel (including your edits)',
  '5': 'The live design in the design panel',
  '6': 'The validated design, reduced to the customer allowlist',
  '7': 'Current design + your plain-English instruction',
  '8': 'Stage 5 margins for the current design',
}

export function StageInput({ id }: { id: StageId }) {
  return (
    <div className="max-w-4xl space-y-5 animate-in">
      <div className="flex items-center gap-2 text-[12.5px] text-ink-3"><Link2 className="size-3.5" /> Source: <span className="text-ink-2">{SOURCE[id]}</span></div>
      <Body id={id} />
    </div>
  )
}

function Body({ id }: { id: StageId }) {
  const s = useStudio()
  const reg = useRuntime(r => r.registry)
  const design = useDesign()
  useStudio(x => x.spec); useStudio(x => x.ranked)

  if (id === '1') return <EmailInput />
  if (id === '1b') return <ImageInput />
  if (id === '2') {
    const pool = reg.precedents.filter(p => p.part_type === s.partType)
    return (
      <>
        <CodeBlock title="Query text sent to the embedding model" code={userInput('2')} maxH="max-h-24" />
        <div>
          <SectionTitle>Precedent library · {pool.length} for {reg.parts[s.partType]?.label}</SectionTitle>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {pool.map(p => (
              <li key={p.id} className="flex gap-3 px-3.5 py-2.5">
                <span className="font-mono text-[12px] text-accent">{p.id}</span>
                <span className="flex-1 text-[12.5px] text-ink-2">{p.text}</span>
                <Badge tone={p.outcome === 'clean' ? 'success' : 'danger'}>{p.outcome}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </>
    )
  }
  if (id === '3') return (
    <>
      {s.feedback.stage3 && <div className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-[12.5px] text-warning">This input includes Stage 5 feedback from a rejected attempt.</div>}
      <CodeBlock title="User message" code={userInput('3')} maxH="max-h-[520px]" />
    </>
  )
  if (id === '4' || id === '5') return (
    <>
      <CodeBlock title={id === '4' ? 'Parameter JSON sent to the code model' : 'Design under test'} code={userInput(id)} maxH="max-h-[520px]" lang="json" />
      {id === '4' && <CodeBlock title="CAD strategy (from the registry)" code={reg.parts[s.partType]?.cadHint ?? ''} maxH="max-h-40" />}
    </>
  )
  if (id === '6') return (
    <>
      <p className="text-[13px] text-ink-2">Only allowlisted fields cross to the customer — part dimensions, machine, material, speed and container size. Cost, tolerances, scores, rankings and model output never do.</p>
      <CodeBlock title="Customer payload preview" code={JSON.stringify(customerPayload(), null, 2)} maxH="max-h-[520px]" lang="json" />
    </>
  )
  if (id === '7') return <RefineInput />
  // Stage 8
  const card = validateDesign(design)
  return <CodeBlock title="Feature vector (from Stage 5 computed margins)" code={JSON.stringify({ part_type: design.part_type, material_id: design.material_id, ...card.computed }, null, 2)} lang="json" />
}

function EmailInput() {
  const email = useStudio(s => s.email), set = useStudio(s => s.set), fb = useStudio(s => s.feedback.stage1)
  const reg = useRuntime(r => r.registry)
  const samples = useMemo(() => Object.values(reg.parts).flatMap(p => Object.entries(p.samples).map(([k, v]) => ({ key: k, part: p.label, ...v }))), [reg])
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Mail className="size-4 text-ink-3" />
        <NativeSelect aria-label="Load a sample request" value="" className="min-w-72" onChange={k => { const x = samples.find(s => s.key === k); if (x) set({ email: x.text }) }}
          options={[{ value: '', label: 'Load a sample request…' }, ...samples.map(s => ({ value: s.key, label: s.label }))]} />
        <span className="text-[12px] text-ink-3">{email.length} characters</span>
      </div>
      <Textarea value={email} onChange={e => set({ email: e.target.value })} className="min-h-72 font-mono text-[12.5px]" aria-label="Customer email" data-testid="email-input"
        placeholder="Paste the customer's request here — Stage 1 extracts only what is explicitly stated." />
      {fb && <CodeBlock title="Loop feedback appended to the Stage 1 prompt" code={fb} maxH="max-h-48" />}
    </>
  )
}

function ImageInput() {
  const [img, setImg] = useState<string | null>(null)
  const [name, setName] = useState('')
  const running = useRuntime(r => r.running)
  const onFile = (f: File | undefined) => {
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => { setImg(String(rd.result)); setName(f.name) }
    rd.readAsDataURL(f)
  }
  return (
    <>
      <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files[0]) }}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface px-6 py-10 text-center hover:border-accent/60 transition">
        {img ? <img src={img} alt={name} className="max-h-64 rounded-lg" /> : <ImagePlus className="size-8 text-ink-3" />}
        <span className="text-[13.5px] font-medium text-ink">{img ? name : 'Drop a drawing or photo, or click to browse'}</span>
        <span className="text-[12px] text-ink-3">PNG or JPG. Sent only to your local vision model.</span>
        <input type="file" accept="image/*" className="sr-only" onChange={e => onFile(e.target.files?.[0])} />
      </label>
      <Button variant="primary" icon={<Play className="size-3.5" />} disabled={!img || running} onClick={() => runStage('1b', { image: img!.split(',')[1] })}>Extract spec from image</Button>
    </>
  )
}

function RefineInput() {
  const refine = useStudio(s => s.refine), set = useStudio(s => s.set), partType = useStudio(s => s.partType)
  const running = useRuntime(r => r.running)
  const ideas: Record<string, string[]> = {
    starwheel: ['Loosen the pocket fit by 0.3 mm', 'Make the wheel 4 mm thicker', 'Switch the material to POM'],
    feed_screw: ['Use 3 starts instead of 2', 'Lengthen the screw to 560 mm', 'Make it left-hand'],
    guide_rail: ['Reduce the wrap to 150 degrees', 'Raise the contact height to 110 mm', 'Make the rail 14 mm thick'],
  }
  const instruction = refine?.instruction ?? ''
  return (
    <>
      <Textarea value={instruction} onChange={e => set({ refine: { instruction: e.target.value, delta: null, drift: [], ignored: [] } })}
        className="min-h-28" placeholder="Describe one change in plain English, e.g. “loosen the pocket fit by 0.3 mm”" aria-label="Edit instruction" />
      <div className="flex flex-wrap gap-1.5">
        {(ideas[partType] ?? []).map(t => (
          <button key={t} onClick={() => set({ refine: { instruction: t, delta: null, drift: [], ignored: [] } })}
            className="rounded-full border border-border bg-surface px-3 py-1 text-[12.5px] text-ink-2 hover:border-accent/50 hover:text-ink cursor-pointer">{t}</button>
        ))}
      </div>
      <Button variant="primary" icon={<Play className="size-3.5" />} disabled={!instruction.trim() || running} onClick={() => { set({ tab: 'output' }); runStage('7') }}>Apply edit</Button>
    </>
  )
}
