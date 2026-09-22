import { useMemo } from 'react'
import { CircleCheck, CircleX, ShieldCheck, TriangleAlert, Wrench } from 'lucide-react'
import { validateDesign, type Design, type Scorecard as Card } from '@/core/validate'
import { classifyFailure, repairHints } from '@/core/repair'
import { Badge, cn, Meter, SectionTitle } from '@/ui/primitives'

export function VerdictPill({ card, size = 'md' }: { card: Card; size?: 'sm' | 'md' }) {
  const tone = card.verdict === 'accept' ? 'bg-success-soft text-success' : card.verdict === 'reject' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'
  const Icon = card.verdict === 'accept' ? CircleCheck : card.verdict === 'reject' ? CircleX : TriangleAlert
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-wide', tone, size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-[12px]')} data-testid="verdict">
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />{card.verdict}
      {card.verdict === 'accept' && <span className="font-mono font-medium opacity-80">· {card.score.toFixed(2)}</span>}
    </span>
  )
}

export function Scorecard({ design, label, compact }: { design: Design; label: string; compact?: boolean }) {
  const card = useMemo(() => validateDesign(design, label), [design, label])
  const hints = useMemo(() => repairHints(card, design), [card, design])
  const { route } = classifyFailure(card)
  const failing = card.checks.filter(c => !c.pass).length

  return (
    <div className="space-y-5" data-testid="scorecard">
      <div className="flex flex-wrap items-center gap-3">
        <VerdictPill card={card} />
        <span className="text-[13px] text-ink-2">
          {card.verdict === 'accept' ? `All ${card.checks.length} checks pass` : card.verdict === 'reject' ? `${failing} of ${card.checks.length} checks fail` : 'No physics implemented for this part type'}
        </span>
        {route !== 'none' && <Badge tone="warning">Feedback → {route === 'stage1' ? 'Stage 1 · spec conflict' : 'Stage 3 · geometry'}</Badge>}
      </div>

      {card.tiles.length > 0 && (
        <div className={cn('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-3')}>
          {card.tiles.map(t => (
            <div key={t.label} className="rounded-lg border border-border bg-surface-2/50 p-2.5">
              <div className="text-[11px] text-ink-3 truncate">{t.label}</div>
              <div className={cn('num mt-0.5 font-mono text-[15px] font-semibold', t.ok ? 'text-ink' : 'text-danger')}>
                {t.value ?? '—'}<span className="ml-1 text-[11px] font-normal text-ink-3">{t.unit}</span>
              </div>
              <Meter className="mt-2" fraction={t.fraction} ok={t.ok} />
            </div>
          ))}
        </div>
      )}

      <div>
        <SectionTitle>Checks</SectionTitle>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {card.checks.map(c => (
            <li key={c.id} className="flex gap-2.5 px-3 py-2" data-check={c.id} data-pass={c.pass}>
              {c.pass ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-danger" />}
              <div className="min-w-0">
                <div className="text-[13px] text-ink">{c.label}</div>
                {!c.pass && <div className="mt-0.5 text-[12.5px] text-danger/90">{c.reason}</div>}
                {!c.pass && c.cite && <div className="mt-0.5 text-[11.5px] text-ink-3">{c.cite}</div>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {!compact && card.formulas.length > 0 && (
        <div>
          <SectionTitle>Working</SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[12.5px]">
              <thead className="bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-ink-3">
                <tr><th className="px-3 py-2 font-semibold">Quantity</th><th className="px-3 py-2 font-semibold">Formula</th><th className="px-3 py-2 font-semibold text-right">Result</th><th className="px-3 py-2 font-semibold text-right">Limit</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {card.formulas.map(f => (
                  <tr key={f.label}>
                    <td className="px-3 py-2 text-ink whitespace-nowrap">{f.label}</td>
                    <td className="px-3 py-2 font-mono text-[11.5px] text-ink-2">{f.expr}</td>
                    <td className={cn('num px-3 py-2 text-right font-mono whitespace-nowrap', f.ok ? 'text-ink' : 'text-danger font-semibold')}>{f.result}</td>
                    <td className="num px-3 py-2 text-right font-mono text-ink-3 whitespace-nowrap">{f.limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hints.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning-soft p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-warning"><Wrench className="size-3.5" /> Computed corrections (sent to the model on loop)</div>
          <ul className="space-y-1 text-[12.5px] leading-relaxed text-ink-2">{hints.map(h => <li key={h} className="font-mono text-[11.5px]">{h}</li>)}</ul>
        </div>
      )}
      {!compact && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3"><ShieldCheck className="size-3.5" /> Deterministic — exact arithmetic against validation_standards.json. No model involved.</p>
      )}
    </div>
  )
}
