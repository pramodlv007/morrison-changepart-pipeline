/**
 * Primitive components shared by Studio (dark) and Portal (light). They only use
 * semantic tokens (bg-surface, text-ink-2, …) so both themes come for free.
 */
import { forwardRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import * as RTooltip from '@radix-ui/react-tooltip'
import * as RToggle from '@radix-ui/react-toggle-group'
import { Check, Copy, LoaderCircle } from 'lucide-react'
import clsx from 'clsx'

export const cn = clsx

/* ---------------- Button ---------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gradient'
type Size = 'sm' | 'md' | 'lg'
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95 shadow-sm',
  gradient: 'bg-gradient-accent text-white hover:brightness-110 active:brightness-95 shadow-[0_8px_24px_-8px_var(--accent)]',
  secondary: 'bg-surface-2 text-ink border border-border hover:bg-surface-3 hover:border-border-strong',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger border border-transparent hover:border-danger/40',
}
const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-[13.5px] gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading}
      className={cn('inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-[background,border,filter,color] duration-150 disabled:opacity-45 disabled:pointer-events-none cursor-pointer',
        VARIANT[variant], SIZE[size], className)} {...rest}>
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md'; tipSide?: 'top' | 'bottom' | 'left' | 'right' }>(
  function IconButton({ label, active, size = 'md', tipSide, className, children, ...rest }, ref) {
    return (
      <Tip label={label} side={tipSide}>
        <button ref={ref} aria-label={label} aria-pressed={active}
          className={cn('inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none',
            size === 'sm' ? 'size-7' : 'size-9',
            active ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:text-ink hover:bg-surface-2', className)} {...rest}>
          {children}
        </button>
      </Tip>
    )
  })

/* ---------------- Tooltip ---------------- */
export function Tip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6}
          className="z-50 max-w-72 rounded-md bg-ink px-2 py-1 text-[12px] font-medium text-bg shadow-lg animate-in">
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}
export const TipProvider = RTooltip.Provider

/* ---------------- Badge ---------------- */
type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'violet' | 'teal'
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-border',
  accent: 'bg-accent-soft text-accent border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  violet: 'bg-[color-mix(in_srgb,var(--accent-2)_14%,transparent)] text-accent-2 border-transparent',
  teal: 'bg-[color-mix(in_srgb,var(--accent-3)_14%,transparent)] text-accent-3 border-transparent',
}
export function Badge({ tone = 'neutral', className, children, dot }: { tone?: Tone; className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 h-5 px-2 rounded-full border text-[11.5px] font-medium whitespace-nowrap', TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/* ---------------- Card / Section ---------------- */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-border bg-surface shadow-card', className)} {...rest}>{children}</div>
}
export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-2 mb-2', className)}>
      <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{children}</h3>
      {right}
    </div>
  )
}

/* ---------------- Form controls ---------------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-[13.5px] text-ink placeholder:text-ink-3 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent-soft', className)} {...rest} />
})
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn('w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed text-ink placeholder:text-ink-3 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent-soft resize-y', className)} {...rest} />
})
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  )
}
export function NativeSelect({ value, onChange, options, className, ...rest }:
  { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; 'aria-label'?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label={rest['aria-label']}
      className={cn('h-9 rounded-lg border border-border bg-surface-2 pl-3 pr-8 text-[13.5px] text-ink outline-none cursor-pointer focus:border-accent appearance-none bg-no-repeat bg-[right_0.6rem_center] bg-[length:12px]', className)}
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

/* ---------------- Segmented control ---------------- */
export function Segmented<T extends string>({ value, onChange, options, size = 'md', className, label }:
  { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; size?: 'sm' | 'md'; className?: string; label: string }) {
  return (
    <RToggle.Root type="single" value={value} aria-label={label} onValueChange={v => v && onChange(v as T)}
      className={cn('inline-flex rounded-lg bg-surface-2 p-0.5 border border-border', className)}>
      {options.map(o => (
        <RToggle.Item key={o.value} value={o.value}
          className={cn('inline-flex items-center gap-1.5 rounded-md font-medium text-ink-2 transition cursor-pointer data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-sm hover:text-ink',
            size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-8 px-3 text-[13px]')}>
          {o.icon}{o.label}
        </RToggle.Item>
      ))}
    </RToggle.Root>
  )
}

/* ---------------- Misc ---------------- */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-mono text-[10.5px] text-ink-3">{children}</kbd>
}
export function Skeleton({ className }: { className?: string }) { return <div className={cn('skeleton h-4', className)} /> }
export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center gap-2 py-10 px-6', className)}>
      {icon && <div className="mb-1 grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">{icon}</div>}
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {body && <div className="max-w-sm text-[13px] text-ink-2 leading-relaxed">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
export function Meter({ fraction, ok, className }: { fraction: number; ok: boolean; className?: string }) {
  const f = Math.max(0.03, Math.min(1, fraction || 0))
  return (
    <div className={cn('h-1.5 w-full rounded-full bg-surface-3 overflow-hidden', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', ok ? 'bg-success' : 'bg-danger')} style={{ width: `${f * 100}%` }} />
    </div>
  )
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className={cn('inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-[11.5px] text-ink-3 hover:text-ink hover:bg-surface-3 cursor-pointer', className)}
      onClick={async () => { try { await navigator.clipboard.writeText(text) } catch { /* clipboard blocked */ } setDone(true); setTimeout(() => setDone(false), 1400) }}>
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}{done ? 'Copied' : label}
    </button>
  )
}

export function CodeBlock({ code, lang, className, maxH = 'max-h-80', title }: { code: string; lang?: string; className?: string; maxH?: string; title?: ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-border bg-bg overflow-hidden', className)}>
      <div className="flex items-center justify-between h-8 px-3 border-b border-border bg-surface-2/60">
        <span className="text-[11.5px] font-medium text-ink-3">{title ?? lang ?? 'text'}</span>
        <CopyButton text={code} />
      </div>
      <pre className={cn('overflow-auto p-3 font-mono text-[12px] leading-[1.65] text-ink-2 whitespace-pre-wrap break-words', maxH)}>{code || ' '}</pre>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) { return <LoaderCircle className={cn('size-4 animate-spin', className)} /> }
