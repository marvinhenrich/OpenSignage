import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, Badge, PageHeader } from '../components/ui'

interface Entry {
  id: string; action: string; entity: string; entityId?: string | null
  detail?: { path?: string; method?: string; status?: number } | null
  createdAt: string; username?: string | null
}

const ENTITIES = ['', 'auth', 'layouts', 'media', 'campaigns', 'displays', 'display-groups', 'schedules', 'users']

export default function Audit() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [entity, setEntity] = useState('')
  const [err, setErr] = useState('')

  const load = (e: string) => api.get<{ entries: Entry[] }>(`/audit${e ? `?entity=${e}` : ''}`)
    .then((r) => setEntries(r.entries)).catch((x: any) => setErr(x.message))
  useEffect(() => { load(entity) }, [entity])

  function statusTone(s?: number) {
    if (!s) return 'slate'
    if (s < 300) return 'green'
    return 'amber'
  }

  return (
    <div>
      <PageHeader title="Audit-Log" subtitle="Lückenlose Protokollierung aller Aktionen" action={
        <select value={entity} onChange={(e) => setEntity(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
          {ENTITIES.map((x) => <option key={x} value={x}>{x === '' ? 'Alle Bereiche' : x}</option>)}
        </select>
      } />
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div>}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <tr>
                <th className="px-5 py-3 font-medium">Zeitpunkt</th>
                <th className="px-5 py-3 font-medium">Benutzer</th>
                <th className="px-5 py-3 font-medium">Aktion</th>
                <th className="px-5 py-3 font-medium">Bereich</th>
                <th className="px-5 py-3 font-medium">Objekt-ID</th>
                <th className="px-5 py-3 font-medium">Ergebnis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="whitespace-nowrap px-5 py-2.5 text-slate-500">{new Date(e.createdAt).toLocaleString('de-DE')}</td>
                  <td className="px-5 py-2.5 font-medium">{e.username ?? <span className="text-slate-400">System/anonym</span>}</td>
                  <td className="px-5 py-2.5 font-mono text-xs">{e.action}</td>
                  <td className="px-5 py-2.5">{e.entity}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{e.entityId ? e.entityId.slice(0, 8) : '—'}</td>
                  <td className="px-5 py-2.5"><Badge tone={statusTone(e.detail?.status) as any}>{e.detail?.status ?? '—'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 && <div className="p-6 text-sm text-slate-400">Keine Einträge.</div>}
      </Card>
    </div>
  )
}
