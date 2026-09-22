/** Tabs, dialogs/sheets and toasts. */
import type { ReactNode } from 'react'
import * as RTabs from '@radix-ui/react-tabs'
import * as RDialog from '@radix-ui/react-dialog'
import { create } from 'zustand'
import { TriangleAlert, CircleCheck, Info, X, CircleX } from 'lucide-react'
import { cn } from './primitives'

/* ---------------- Tabs ---------------- */
export function Tabs({ value, onChange, tabs, className, children }:
  { value: string; onChange: (v: string) => void; tabs: { value: string; label: ReactNode; badge?: ReactNode }[]; className?: string; children: ReactNode }) {
  return (
    <RTabs.Root value={value} onValueChange={onChange} className={cn('flex flex-col min-h-0', className)}>
      <RTabs.List className="flex items-center gap-1 border-b border-border px-4 shrink-0 overflow-x-auto">
        {tabs.map(t => (
          <RTabs.Trigger key={t.value} value={t.value}
            className="relative inline-flex items-center gap-1.5 h-10 px-2.5 text-[13px] font-medium text-ink-3 hover:text-ink transition cursor-pointer whitespace-nowrap
              data-[state=active]:text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent after:opacity-0 data-[state=active]:after:opacity-100">
            {t.label}{t.badge}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  )
}
export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return <RTabs.Content value={value} className={cn('flex-1 min-h-0 overflow-auto outline-none', className)}>{children}</RTabs.Content>
}

/* ---------------- Dialog & Sheet ---------------- */
export function Dialog({ open, onOpenChange, title, description, children, className, footer }:
  { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] animate-in" />
        <RDialog.Content className={cn('fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface shadow-2xl animate-in outline-none', className)}>
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div>
              <RDialog.Title className="text-[16px] font-semibold text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-[13px] text-ink-2">{description}</RDialog.Description>
                : <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>}
            </div>
            <RDialog.Close className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink cursor-pointer" aria-label="Close"><X className="size-4" /></RDialog.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

export function Sheet({ open, onOpenChange, title, description, children, side = 'right', width = 'w-[min(460px,100vw)]' }:
  { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; side?: 'right' | 'bottom'; width?: string }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/35 animate-in" />
        <RDialog.Content className={cn('fixed z-50 flex flex-col border-border bg-surface shadow-2xl outline-none animate-in',
          side === 'right' ? cn('inset-y-0 right-0 border-l', width) : 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t')}>
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <RDialog.Title className="text-[15px] font-semibold text-ink">{title}</RDialog.Title>
              <RDialog.Description className={description ? 'mt-0.5 text-[12.5px] text-ink-2' : 'sr-only'}>{description ?? 'Panel'}</RDialog.Description>
            </div>
            <RDialog.Close className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink cursor-pointer" aria-label="Close"><X className="size-4" /></RDialog.Close>
          </div>
          <div className="flex-1 overflow-auto">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/* ---------------- Toasts ---------------- */
type ToastTone = 'info' | 'success' | 'warning' | 'error'
interface ToastItem { id: number; tone: ToastTone; title: string; body?: string }
const useToasts = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, 'id'>) => void; drop: (id: number) => void }>(set => ({
  items: [],
  push: t => {
    const id = Date.now() + Math.random()
    set(s => ({ items: [...s.items.slice(-3), { ...t, id }] }))
    setTimeout(() => set(s => ({ items: s.items.filter(i => i.id !== id) })), t.tone === 'error' ? 7000 : 3800)
  },
  drop: id => set(s => ({ items: s.items.filter(i => i.id !== id) })),
}))
export const toast = {
  info: (title: string, body?: string) => useToasts.getState().push({ tone: 'info', title, body }),
  success: (title: string, body?: string) => useToasts.getState().push({ tone: 'success', title, body }),
  warning: (title: string, body?: string) => useToasts.getState().push({ tone: 'warning', title, body }),
  error: (title: string, body?: string) => useToasts.getState().push({ tone: 'error', title, body }),
}
const TOAST_ICON = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleX }
const TOAST_COLOR = { info: 'text-accent', success: 'text-success', warning: 'text-warning', error: 'text-danger' }
export function Toaster() {
  const { items, drop } = useToasts()
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" role="status" aria-live="polite">
      {items.map(t => {
        const I = TOAST_ICON[t.tone]
        return (
          <div key={t.id} className="pointer-events-auto flex gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-2xl animate-in">
            <I className={cn('mt-0.5 size-4.5 shrink-0', TOAST_COLOR[t.tone])} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-ink">{t.title}</div>
              {t.body && <div className="mt-0.5 text-[12.5px] text-ink-2 break-words">{t.body}</div>}
            </div>
            <button onClick={() => drop(t.id)} className="text-ink-3 hover:text-ink cursor-pointer" aria-label="Dismiss"><X className="size-4" /></button>
          </div>
        )
      })}
    </div>
  )
}
