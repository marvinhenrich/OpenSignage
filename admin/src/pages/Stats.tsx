import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, PageHeader, StatTile } from '../components/ui'
import { IconChart, IconDisplays, IconLayouts, IconMedia } from '../components/icons'

interface Overview {
  kpi: { playsLast7d: number; displaysTotal: number; displaysOnline: number; mediaCount: number; layoutsCount: number }
  playsPerDay: { day: string; count: number }[]
  topMedia: { name: string; count: number }[]
  topLayouts: { name: string; count: number }[]
}

export default function Stats() {
  const [d, setD] = useState<Overview | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get<Overview>('/stats/overview').then(setD).catch((e) => setErr(e.message)) }, [])

  if (err) return <div><PageHeader title="Statistik" /><div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div></div>
  if (!d) return <div><PageHeader title="Statistik" /><div className="text-slate-400">Lädt…</div></div>

  return (
    <div>
      <PageHeader title="Statistik" subtitle="Proof-of-Play & Betrieb der letzten 7–14 Tage" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Wiedergaben (7 Tage)" value={d.kpi.playsLast7d.toLocaleString('de-DE')} icon={<IconChart className="h-6 w-6" />} />
        <StatTile label="Displays online" value={`${d.kpi.displaysOnline}/${d.kpi.displaysTotal}`} tone={d.kpi.displaysOnline > 0 ? 'good' : 'default'} icon={<IconDisplays className="h-6 w-6" />} />
        <StatTile label="Layouts" value={d.kpi.layoutsCount} icon={<IconLayouts className="h-6 w-6" />} />
        <StatTile label="Medien" value={d.kpi.mediaCount} icon={<IconMedia className="h-6 w-6" />} />
      </div>

      <div className="mt-6">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Wiedergaben pro Tag (14 Tage)</h2>
          <DayBars data={d.playsPerDay} />
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Top-Medien (7 Tage)</h2>
          <HBars data={d.topMedia} empty="Noch keine Wiedergaben erfasst." />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Top-Layouts (7 Tage)</h2>
          <HBars data={d.topLayouts} empty="Noch keine Wiedergaben erfasst." />
        </Card>
      </div>
    </div>
  )
}

/** 14-Tage-Balken (SVG), fehlende Tage = 0. */
function DayBars({ data }: { data: { day: string; count: number }[] }) {
  const days: { label: string; day: string }[] = []
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86_400_000)
    days.push({ day: dt.toISOString().slice(0, 10), label: dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) })
  }
  const map = new Map(data.map((r) => [r.day, r.count]))
  const vals = days.map((d) => map.get(d.day) ?? 0)
  const max = Math.max(1, ...vals)
  return (
    <div className="flex items-end gap-1.5" style={{ height: 160 }}>
      {days.map((d, i) => (
        <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.label}: ${vals[i]}`}>
          <div className="w-full rounded-t bg-brand-500" style={{ height: `${(vals[i] / max) * 130 + 2}px` }} />
          <div className="text-[10px] text-slate-400">{d.label.slice(0, 2)}</div>
        </div>
      ))}
    </div>
  )
}

/** Horizontale Balkenliste. */
function HBars({ data, empty }: { data: { name: string; count: number }[]; empty: string }) {
  if (data.length === 0) return <div className="text-sm text-slate-400">{empty}</div>
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.name}>
          <div className="mb-1 flex justify-between text-sm"><span className="truncate">{d.name}</span><span className="tabular-nums text-slate-400">{d.count}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
