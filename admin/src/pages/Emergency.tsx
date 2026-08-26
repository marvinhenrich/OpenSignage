import { useEffect, useState } from 'react'
import { api, type Display, type DisplayGroup } from '../lib/api'
import { notify, notifyOk } from '../lib/toast'
import { Button, Card, PageHeader, Badge } from '../components/ui'
import { IconAlert } from '../components/icons'

const PRESETS = [
  { label: 'Rot (Notfall)', background: '#b91c1c', color: '#ffffff' },
  { label: 'Orange (Hinweis)', background: '#c2410c', color: '#ffffff' },
  { label: 'Blau (Info)', background: '#1d4ed8', color: '#ffffff' },
  { label: 'Schwarz', background: '#000000', color: '#ffffff' },
]

export default function Emergency() {
  const [displays, setDisplays] = useState<Display[]>([])
  const [groups, setGroups] = useState<DisplayGroup[]>([])
  const [active, setActive] = useState<{ id: string; name: string; text: string }[]>([])

  const [text, setText] = useState('')
  const [subtext, setSubtext] = useState('')
  const [preset, setPreset] = useState(0)
  const [targetKind, setTargetKind] = useState<'all' | 'group' | 'display'>('all')
  const [targetId, setTargetId] = useState('')

  const loadActive = () => api.get<{ active: typeof active }>('/emergency/active').then((r) => setActive(r.active)).catch(() => {})
  useEffect(() => {
    api.get<{ displays: Display[] }>('/displays').then((r) => setDisplays(r.displays)).catch(() => {})
    api.get<{ groups: DisplayGroup[] }>('/display-groups').then((r) => setGroups(r.groups)).catch(() => {})
    loadActive()
  }, [])

  function targets() {
    if (targetKind === 'all') return { all: true }
    if (targetKind === 'group') return { groupIds: targetId ? [targetId] : [] }
    return { displayIds: targetId ? [targetId] : [] }
  }

  async function send() {
    if (!text.trim()) { notify('Bitte eine Meldung eingeben'); return }
    try {
      const r = await api.post<{ count: number }>('/emergency', {
        targets: targets(), text: text.trim(), subtext: subtext.trim() || undefined,
        background: PRESETS[preset].background, color: PRESETS[preset].color,
      })
      notifyOk(`Einblendung an ${r.count} Display(s) gesendet`)
      loadActive()
    } catch (e: any) { notify(e.message) }
  }
  async function clearAll() {
    try { const r = await api.post<{ count: number }>('/emergency/clear', { targets: { all: true } }); notifyOk(`Einblendung auf ${r.count} Display(s) beendet`); loadActive() }
    catch (e: any) { notify(e.message) }
  }

  const p = PRESETS[preset]

  return (
    <div>
      <PageHeader title="Sofort-Einblendung" subtitle="Meldung sofort auf Displays schieben — hat Vorrang vor allem" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Meldung</label>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="z. B. Gebäude räumen!"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-lg font-semibold dark:border-slate-700 dark:bg-slate-950" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Zusatztext (optional)</label>
              <input value={subtext} onChange={(e) => setSubtext(e.target.value)} placeholder="z. B. Sammelplatz Parkplatz A"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Farbe</label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((x, i) => (
                  <button key={i} onClick={() => setPreset(i)}
                    className={`rounded-md px-3 py-1.5 text-sm text-white cursor-pointer ${preset === i ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-900' : ''}`}
                    style={{ background: x.background }}>{x.label}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Ziel</label>
                <select value={targetKind} onChange={(e) => { setTargetKind(e.target.value as any); setTargetId('') }}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                  <option value="all">Alle Displays</option>
                  <option value="group">Gruppe</option>
                  <option value="display">Einzelnes Display</option>
                </select>
              </div>
              {targetKind !== 'all' && (
                <div>
                  <label className="mb-1 block text-sm font-medium">{targetKind === 'group' ? 'Gruppe' : 'Display'}</label>
                  <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                    <option value="">Auswählen…</option>
                    {(targetKind === 'group' ? groups : displays).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <Button variant="danger" onClick={send} className="w-full"><IconAlert className="h-4 w-4" />Jetzt einblenden</Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div className="p-3 text-sm font-medium text-slate-500 dark:text-slate-400">Vorschau</div>
            <div className="flex aspect-video flex-col items-center justify-center p-6 text-center" style={{ background: p.background, color: p.color }}>
              <div className="text-2xl font-extrabold leading-tight">{text || 'Meldung…'}</div>
              {subtext && <div className="mt-2 text-sm opacity-90">{subtext}</div>}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Aktive Einblendungen</h2>
              {active.length > 0 && <Button variant="ghost" onClick={clearAll}>Alle beenden</Button>}
            </div>
            {active.length === 0 ? (
              <div className="text-sm text-slate-400">Keine aktive Einblendung.</div>
            ) : (
              <ul className="space-y-2">
                {active.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                    <span className="min-w-0 truncate">{a.name}</span>
                    <Badge tone="amber">{a.text}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
