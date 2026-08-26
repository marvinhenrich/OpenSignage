import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useBrand } from '../lib/brand'
import { useT } from '../i18n'
import { Button } from '../components/ui'
import { IconTv } from '../components/icons'

export default function Login() {
  const brand = useBrand()
  const { login } = useAuth()
  const t = useT()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await login(username, password)
    } catch (err: any) {
      setError(err?.message ?? 'Anmeldung fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <IconTv className="h-7 w-7" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold">{brand.name}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Digital Signage CMS</p>
          </div>
        </div>

        <form onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <label htmlFor="u" className="mb-1.5 block text-sm font-medium">Benutzername</label>
            <input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
          </div>
          <div>
            <label htmlFor="p" className="mb-1.5 block text-sm font-medium">Passwort</label>
            <input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
          </div>
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Anmelden…' : 'Anmelden'}
          </Button>
        </form>
      </div>
    </div>
  )
}
