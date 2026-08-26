import React, { createContext, useContext, useEffect, useState } from 'react'

type ToastType = 'success' | 'error' | 'info'
interface Toast { id: string; message: string; type: ToastType }

const Ctx = createContext<{ push: (m: string, t?: ToastType) => void }>({ push: () => {} })
export const useToast = () => useContext(Ctx)

// Modul-Level-Funktion: von überall (auch außerhalb React) aufrufbar.
let emit: ((m: string, t?: ToastType) => void) | null = null
export function notify(message: string, type: ToastType = 'error') { emit?.(message, type) }
export function notifyOk(message: string) { emit?.(message, 'success') }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = (message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }
  useEffect(() => { emit = push; return () => { emit = null } }, [])

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
            className={'pointer-events-auto cursor-pointer rounded-lg border px-4 py-3 text-sm shadow-lg transition-all ' + toneCls(t.type)}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5">{icon(t.type)}</span>
              <span className="flex-1">{t.message}</span>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

function toneCls(t: ToastType) {
  if (t === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
  if (t === 'error') return 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
  return 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
}
function icon(t: ToastType) {
  const c = 'inline-block h-4 w-4'
  if (t === 'success') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={c}><path d="M20 6 9 17l-5-5" /></svg>
  if (t === 'error') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={c}><path d="M18 6 6 18M6 6l12 12" /></svg>
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={c}><path d="M12 8v4M12 16h.01" /><circle cx="12" cy="12" r="9" /></svg>
}
