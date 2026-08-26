import { useEffect, useState } from 'react'
import { notify, notifyOk } from '../lib/toast'
import { useEscape } from '../lib/useEscape'
import { api, type Display, type Layout } from '../lib/api'
import { Button, Card, PageHeader, EmptyState, StatusDot, Badge, Skeleton } from '../components/ui'
import { IconTrash } from '../components/icons'

function seit(ts?: string | null) {
  if (!ts) return 'nie'
  const min = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `vor ${h} h`
  return `vor ${Math.floor(h / 24)} d`
}

export default function DisplaysPage() {
  const [items, setItems] = useState<Display[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [sel, setSel] = useState<Display | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => api.get<{ displays: Display[] }>('/displays').then((r) => setItems(r.displays)).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  useEffect(() => { load(); api.get<{ layouts: Layout[] }>('/layouts').then((r) => setLayouts(r.layouts)).catch((e: any) => notify(e.message)) }, [])

  return (
    <div>
      <PageHeader title="Displays" subtitle="Angebundene Player, Freigabe und Standard-Inhalt" />
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div>}

      {loading ? (
        <Card className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</Card>
      ) : items.length === 0 ? (
        <EmptyState title="Noch keine Displays" hint="Sobald ein Player-Client startet (/player), taucht er hier zur Freigabe auf." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Auflösung</th>
                  <th className="px-5 py-3 font-medium">Zuletzt gesehen</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((d) => (
                  <tr key={d.id} onClick={() => setSel(d)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-5 py-3">
                      <div className="font-medium">{d.name}</div>
                      {!d.authorized && <Badge tone="amber">wartet auf Freigabe</Badge>}
                    </td>
                    <td className="px-5 py-3"><StatusDot status={d.status} /></td>
                    <td className="px-5 py-3 tabular-nums text-slate-500">{d.resolutionW ? `${d.resolutionW}×${d.resolutionH}` : '—'}</td>
                    <td className="px-5 py-3 text-slate-500">{seit(d.lastSeenAt)}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-400">bearbeiten →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {sel && <DisplayDrawer display={sel} layouts={layouts} onClose={() => setSel(null)} onChanged={async () => { await load(); }} onDeleted={() => { setSel(null); load() }} />}
    </div>
  )
}

function DisplayDrawer({ display, layouts, onClose, onChanged, onDeleted }: {
  display: Display; layouts: Layout[]; onClose: () => void; onChanged: () => void; onDeleted: () => void
}) {
  useEscape(onClose)
  const [name, setName] = useState(display.name)
  const [defLayout, setDefLayout] = useState((display as any).defaultLayoutId ?? '')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [shot, setShot] = useState(0)
  const input = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950'

  const [events, setEvents] = useState<{ level: string; code?: string | null; message: string; createdAt: string }[]>([])
  const [uptime, setUptime] = useState<number | null>(null)
  useEffect(() => {
    api.get<{ uptime24h: number; events: typeof events }>(`/displays/${display.id}/events`)
      .then((r) => { setUptime(r.uptime24h); setEvents(r.events) }).catch((e: any) => notify(e.message))
  }, [display.id])

  /**
   * Kopplung zuruecksetzen: loescht das Geraete-Geheimnis. Noetig, wenn ein Geraet neu
   * aufgesetzt wurde - es hat dann ein neues Geheimnis und wuerde sonst dauerhaft
   * abgewiesen. Danach bindet sich das naechste Geraet unter dieser Kennung neu.
   */
  async function resetDevice() {
    if (!confirm('Kopplung dieses Displays zuruecksetzen?\n\nNur noetig, wenn das Geraet neu aufgesetzt wurde. Bis sich das Geraet neu meldet, ist der Uebernahmeschutz fuer dieses Display aufgehoben.')) return
    setErr(''); setMsg('')
    try {
      await api.post(`/displays/${display.id}/reset-device`, {})
      setMsg('Kopplung zurueckgesetzt — das Geraet bindet sich beim naechsten Melden neu.')
      notifyOk('Kopplung zurueckgesetzt')
    } catch (e: any) { setErr(e.message); notify(e.message) }
  }

  async function cmd(code: string) {
    setErr(''); setMsg('')
    try {
      await api.post(`/displays/${display.id}/command`, { code })
      setMsg(`Befehl „${code}" gesendet.`)
      notifyOk(`Befehl „${code}" gesendet`)
      if (code === 'SCREENSHOT') setTimeout(() => setShot(Date.now()), 2500)
    } catch (e: any) { setErr(e.message); notify(e.message) }
  }

  async function save() {
    setErr('')
    try { await api.patch(`/displays/${display.id}`, { name, defaultLayoutId: defLayout || null }); notifyOk('Display gespeichert'); onChanged(); onClose() }
    catch (e: any) { setErr(e.message); notify(e.message) }
  }
  async function authorize() { try { await api.post(`/displays/${display.id}/authorize`); notifyOk('Display freigegeben'); onChanged(); onClose() } catch (e: any) { setErr(e.message); notify(e.message) } }
  async function del() {
    if (!confirm('Display wirklich löschen?')) return
    try { await api.del(`/displays/${display.id}`); notifyOk('Display gelöscht'); onDeleted() } catch (e: any) { setErr(e.message); notify(e.message) }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Display</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">✕</button>
        </div>
        {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div>}

        {!display.authorized && (
          <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
            <div className="text-sm font-medium text-amber-800 dark:text-amber-300">Wartet auf Freigabe</div>
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">Pairing-Code: <span className="font-mono font-bold">{(display as any).pairingCode ?? '—'}</span></div>
            <Button className="mt-3" onClick={authorize}>Jetzt freigeben</Button>
          </div>
        )}

        <div className="space-y-4">
          <label className="block text-sm font-medium">Name<input className={input} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block text-sm font-medium">Standard-Layout
            <select className={input} value={defLayout} onChange={(e) => setDefLayout(e.target.value)}>
              <option value="">— keins —</option>
              {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <span className="mt-1 block text-xs font-normal text-slate-400">Wird angezeigt, wenn kein Zeitplan greift.</span>
          </label>

          <dl className="space-y-1.5 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
            <Row k="Status" v={<StatusDot status={display.status} />} />
            <Row k="Auflösung" v={display.resolutionW ? `${display.resolutionW}×${display.resolutionH}` : '—'} />
            <Row k="Zuletzt gesehen" v={seit(display.lastSeenAt)} />
            <Row k="Client-Version" v={display.clientVersion ?? '—'} />
          </dl>

          {display.authorized && (
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <div className="mb-2 text-sm font-medium">Fernsteuerung</div>
              {msg && <div className="mb-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{msg}</div>}
              {display.status !== 'online' && <div className="mb-2 text-xs text-amber-600 dark:text-amber-400">Display ist offline — Befehle werden erst zugestellt, wenn es online ist.</div>}
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => cmd('RELOAD')}>Inhalt neu laden</Button>
                <Button variant="ghost" onClick={() => cmd('SCREENSHOT')}>Screenshot</Button>
                <Button variant="ghost" onClick={() => cmd('RESTART')}>Player neu starten</Button>
                <Button variant="ghost" onClick={() => { if (confirm('Gerät wirklich neu starten (Reboot)?')) cmd('REBOOT') }}>Reboot</Button>
                <Button variant="ghost" onClick={resetDevice}>Kopplung zurücksetzen</Button>
              </div>
              {shot > 0 && (
                <div className="mt-3">
                  <img src={`/media/screenshots/${display.id}.jpg?t=${shot}`} alt="Screenshot"
                    className="w-full rounded-md border border-slate-200 dark:border-slate-700"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                </div>
              )}
              <p className="mt-2 text-xs text-slate-400">OS-Befehle (Screenshot/Neustart/Reboot) benötigen den Windows-Client — im Edge-Kiosk meldet der Player zurück, dass er sie nicht ausführen kann; die Meldung steht im Protokoll unten.</p>
              <p className="mt-1 text-xs text-slate-400"><b>Kopplung zurücksetzen</b> nur nach einer Neuinstallation des Geräts: löscht das Geräte-Geheimnis, damit sich das Gerät neu binden kann.</p>
            </div>
          )}

          <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Verfügbarkeit (24 h)</span>
              {uptime !== null && <span className={`text-sm font-semibold tabular-nums ${uptime >= 95 ? 'text-emerald-600 dark:text-emerald-400' : uptime >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{uptime}%</span>}
            </div>
            {uptime !== null && (
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className={`h-full rounded-full ${uptime >= 95 ? 'bg-emerald-500' : uptime >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${uptime}%` }} />
              </div>
            )}
            {events.length === 0 ? (
              <div className="text-xs text-slate-400">Noch keine Ereignisse.</div>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                {events.map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className={e.code === 'ONLINE' ? 'text-emerald-600 dark:text-emerald-400' : e.code === 'OFFLINE' ? 'text-red-500' : 'text-slate-500'}>{e.message}</span>
                    <span className="shrink-0 text-slate-400">{new Date(e.createdAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="danger" onClick={del}><IconTrash className="h-4 w-4" />Löschen</Button>
            <Button onClick={save}>Speichern</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-center justify-between"><dt className="text-slate-500 dark:text-slate-400">{k}</dt><dd className="font-medium">{v}</dd></div>
}
