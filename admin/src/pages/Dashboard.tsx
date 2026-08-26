import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Display } from '../lib/api'
import { useAuth } from '../lib/auth'
import { StatTile, PageHeader, Card, StatusDot } from '../components/ui'
import { IconDisplays, IconLayouts, IconMedia, IconChart } from '../components/icons'

interface Overview {
  kpi: { playsLast7d: number; displaysTotal: number; displaysOnline: number; mediaCount: number; layoutsCount: number; storageBytes: number }
}
interface AuditEntry { id: string; action: string; entity: string; createdAt: string; username?: string | null; detail?: { status?: number } | null }

function fmtSize(b?: number) {
  if (!b) return '0 MB'
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function Dashboard() {
  const { user } = useAuth()
  const [ov, setOv] = useState<Overview | null>(null)
  const [displays, setDisplays] = useState<Display[]>([])
  const [activity, setActivity] = useState<AuditEntry[]>([])

  useEffect(() => {
    api.get<Overview>('/stats/overview').then(setOv).catch(() => {})
    api.get<{ displays: Display[] }>('/displays').then((r) => setDisplays(r.displays)).catch(() => {})
    if (user?.role === 'admin') api.get<{ entries: AuditEntry[] }>('/audit?limit=10').then((r) => setActivity(r.entries)).catch(() => {})
  }, [user?.role])

  const k = ov?.kpi

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Überblick über deine Digital-Signage-Flotte" />

      {displays.filter((d) => !d.authorized).length > 0 && (
        <Link to="/displays" className="mb-4 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-900/20">
          <span className="font-medium text-amber-800 dark:text-amber-300">
            {displays.filter((d) => !d.authorized).length} Display(s) warten auf Freigabe
          </span>
          <span className="text-amber-700 hover:underline dark:text-amber-400">Jetzt freigeben →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label="Displays online" value={`${k?.displaysOnline ?? 0}/${k?.displaysTotal ?? 0}`} tone={(k?.displaysOnline ?? 0) > 0 ? 'good' : 'default'} icon={<IconDisplays className="h-6 w-6" />} />
        <StatTile label="Wiedergaben (7 T.)" value={(k?.playsLast7d ?? 0).toLocaleString('de-DE')} icon={<IconChart className="h-6 w-6" />} />
        <StatTile label="Layouts" value={k?.layoutsCount ?? 0} icon={<IconLayouts className="h-6 w-6" />} />
        <StatTile label="Medien" value={k?.mediaCount ?? 0} sub={fmtSize(k?.storageBytes)} icon={<IconMedia className="h-6 w-6" />} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400">Displays</h2>
          <Card>
            {displays.length === 0 ? (
              <div className="p-6 text-sm text-slate-400">Noch keine Displays gekoppelt.</div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {displays.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-slate-400">{d.resolutionW ? `${d.resolutionW}×${d.resolutionH}` : 'unbekannte Auflösung'}</div>
                    </div>
                    <StatusDot status={d.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {user?.role === 'admin' && (
          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400">Letzte Aktivität</h2>
            <Card>
              {activity.length === 0 ? (
                <div className="p-6 text-sm text-slate-400">Keine Einträge.</div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {activity.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                      <span className="min-w-0 truncate"><span className="font-medium">{e.username ?? 'System'}</span> <span className="text-slate-400">· {e.action} {e.entity}</span></span>
                      <span className="shrink-0 text-xs text-slate-400">{new Date(e.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
