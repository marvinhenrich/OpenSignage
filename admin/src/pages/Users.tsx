import { useEffect, useState } from 'react'
import { api, type Role } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Card, Badge, PageHeader } from '../components/ui'
import { IconTrash, IconPlus } from '../components/icons'

interface UserRow {
  id: string; username: string; email?: string | null; role: Role
  authSource: 'local' | 'ad'; isActive: boolean; lastLoginAt?: string | null
}

export default function Users() {
  const { user: me } = useAuth()
  const [rows, setRows] = useState<UserRow[]>([])
  const [err, setErr] = useState('')

  // Anlege-Formular
  const [username, setUsername] = useState('')
  const [authSource, setAuthSource] = useState<'ad' | 'local'>('ad')
  const [role, setRole] = useState<Role>('grafik')
  const [password, setPassword] = useState('')

  const load = () => api.get<{ users: UserRow[] }>('/users').then((r) => setRows(r.users)).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    try {
      await api.post('/users', { username, authSource, role, password: authSource === 'local' ? password : undefined })
      setUsername(''); setPassword('')
      await load()
    } catch (e: any) { setErr(e.message) }
  }
  async function remove(id: string) {
    if (!confirm('Benutzer löschen?')) return
    try { await api.del(`/users/${id}`); await load() } catch (e: any) { setErr(e.message) }
  }

  return (
    <div>
      <PageHeader title="Benutzer" subtitle="Zugänge zum CMS — AD-Anmeldung oder lokales Konto" />

      {err && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr,340px]">
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 font-medium">Benutzer</th>
                <th className="px-4 py-3 font-medium">Anmeldung</th>
                <th className="px-4 py-3 font-medium">Rolle</th>
                <th className="px-4 py-3 font-medium">Zuletzt</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium">{u.username}{u.id === me?.id && <span className="ml-2 text-xs text-slate-400">(du)</span>}</td>
                  <td className="px-4 py-3">
                    <Badge tone={u.authSource === 'ad' ? 'green' : 'slate'}>{u.authSource === 'ad' ? 'Active Directory' : 'Lokal'}</Badge>
                  </td>
                  <td className="px-4 py-3 capitalize">{u.role}</td>
                  <td className="px-4 py-3 text-slate-400">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('de-DE') : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {u.id !== me?.id && (
                      <button onClick={() => remove(u.id)} className="rounded p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"><IconTrash className="h-4 w-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="h-fit p-5">
          <h2 className="mb-4 font-semibold">Benutzer anlegen</h2>
          <form onSubmit={create} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Benutzername</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} required
                placeholder={authSource === 'ad' ? 'AD-Anmeldename (sAMAccountName)' : 'Benutzername'}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Anmeldung</label>
              <select value={authSource} onChange={(e) => setAuthSource(e.target.value as any)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                <option value="ad">Active Directory</option>
                <option value="local">Lokales Passwort</option>
              </select>
              {authSource === 'ad' && <p className="mt-1 text-xs text-slate-400">Passwort wird beim Login gegen das AD geprüft.</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Rolle</label>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                <option value="grafik">Grafik (Display-Inhalte)</option>
                <option value="admin">Admin (alles + Benutzer)</option>
              </select>
            </div>
            {authSource === 'local' && (
              <div>
                <label className="mb-1 block text-sm font-medium">Passwort</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
              </div>
            )}
            <Button type="submit" className="w-full"><IconPlus className="h-4 w-4" />Anlegen</Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
