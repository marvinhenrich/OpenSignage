import React, { useEffect, useState } from 'react'

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

/** Einheitlicher, theme-fähiger Modal-Rahmen (Backdrop + Karte + Escape schließt). */
export function Modal(
  { onClose, children, className, labelledBy }:
  { onClose: () => void; children: React.ReactNode; className?: string; labelledBy?: string },
) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={(e) => e.stopPropagation()}
        className={cn('w-full rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900', className)}>
        {children}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  )
}

export function Button(
  { variant = 'primary', className, onClick, children, disabled, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<unknown> },
) {
  const [busy, setBusy] = useState(false)
  const styles = {
    primary: 'bg-brand-600 hover:bg-brand-500 text-white shadow-sm',
    ghost: 'bg-transparent hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700',
    danger: 'bg-red-600 hover:bg-red-500 text-white',
  }[variant]
  // Gibt der Handler ein Promise zurück, zeigen wir automatisch einen Spinner und sperren den Button.
  const handle = onClick
    ? (e: React.MouseEvent<HTMLButtonElement>) => {
        const r = onClick(e) as unknown
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          setBusy(true)
          Promise.resolve(r).finally(() => setBusy(false))
        }
      }
    : undefined
  return (
    <button
      onClick={handle}
      disabled={disabled || busy}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium',
        'transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
        styles, className,
      )}
      {...props}
    >
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn(
      'rounded-lg border border-slate-200 bg-white shadow-sm',
      'dark:border-slate-800 dark:bg-slate-900', className,
    )}>{children}</div>
  )
}

export function StatTile(
  { label, value, sub, tone = 'default', icon }:
  { label: string; value: React.ReactNode; sub?: string; tone?: 'default' | 'good' | 'bad' | 'warn'; icon?: React.ReactNode },
) {
  const toneCls = {
    default: 'text-slate-900 dark:text-white',
    good: 'text-emerald-600 dark:text-emerald-400',
    bad: 'text-red-600 dark:text-red-400',
    warn: 'text-amber-600 dark:text-amber-400',
  }[tone]
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</div>
          <div className={cn('mt-2 text-3xl font-semibold tabular-nums', toneCls)}>{value}</div>
          {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
        </div>
        {icon && <div className="text-slate-300 dark:text-slate-600">{icon}</div>}
      </div>
    </Card>
  )
}

export function StatusDot({ status }: { status: 'online' | 'offline' | 'pending' }) {
  const map = {
    online: ['bg-emerald-500', 'Online'],
    offline: ['bg-red-500', 'Offline'],
    pending: ['bg-amber-500', 'Wartet'],
  }[status]
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={cn('h-2.5 w-2.5 rounded-full', map[0])} />
      <span className="text-slate-600 dark:text-slate-300">{map[1]}</span>
    </span>
  )
}

export function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'amber' }) {
  const cls = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  }[tone]
  return <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', cls)}>{children}</span>
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
      <p className="font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-400">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/** Skeleton-Platzhalter für Ladezustände. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200 dark:bg-slate-800', className)} />
}
