import { useEffect, useMemo, useState } from 'react'
import { notify, notifyOk } from '../lib/toast'
import { useEscape } from '../lib/useEscape'
import { api, type ScheduleEvent, type Layout, type Campaign, type Display, type DisplayGroup } from '../lib/api'
import { Button, Card, Badge, PageHeader } from '../components/ui'
import { IconPlus, IconTrash } from '../components/icons'

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] // Anzeige (Mo-first)
const WD_IDX = [1, 2, 3, 4, 5, 6, 0] // -> JS getDay (0=So)
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

export default function Schedule() {
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [cursor, setCursor] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() } })
  const [modal, setModal] = useState<null | string>(null) // preselected ISO date or null
  const [err, setErr] = useState('')

  const load = () => api.get<{ schedules: ScheduleEvent[] }>('/schedules').then((r) => setEvents(r.schedules)).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const cells = useMemo(() => buildMonth(cursor.y, cursor.m), [cursor])

  function eventsOn(day: Date): ScheduleEvent[] {
    const ds = new Date(day); ds.setHours(0, 0, 0, 0)
    const de = new Date(day); de.setHours(23, 59, 59, 999)
    return events.filter((e) => {
      const from = new Date(e.fromDt)
      const to = e.toDt ? new Date(e.toDt) : new Date(8640000000000000)
      return from <= de && to >= ds
    })
  }

  return (
    <div>
      <PageHeader title="Zeitplan" subtitle="Layouts und Kampagnen auf Displays/Gruppen planen"
        action={<Button onClick={() => setModal('')}><IconPlus className="h-4 w-4" />Termin anlegen</Button>} />
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div>}

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">{MONTHS[cursor.m]} {cursor.y}</div>
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => setCursor((c) => shift(c, -1))}>‹</Button>
            <Button variant="ghost" onClick={() => { const n = new Date(); setCursor({ y: n.getFullYear(), m: n.getMonth() }) }}>Heute</Button>
            <Button variant="ghost" onClick={() => setCursor((c) => shift(c, 1))}>›</Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md bg-slate-200 dark:bg-slate-800">
          {WD.map((d) => <div key={d} className="bg-slate-50 py-2 text-center text-xs font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400">{d}</div>)}
          {cells.map((cell, i) => {
            const evs = cell ? eventsOn(cell) : []
            const isToday = cell && sameDay(cell, new Date())
            return (
              <div key={i} className={`min-h-[92px] bg-white p-1.5 dark:bg-slate-900 ${!cell ? 'opacity-40' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                onClick={() => cell && setModal(toLocalDateTime(cell, 8, 0))}>
                {cell && (
                  <>
                    <div className={`mb-1 text-xs ${isToday ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white' : 'text-slate-400'}`}>{cell.getDate()}</div>
                    <div className="space-y-1">
                      {evs.slice(0, 3).map((e) => (
                        <div key={e.id} className={`truncate rounded px-1.5 py-0.5 text-[11px] ${e.type === 'campaign' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'}`}
                          title={eventTitle(e)}>{eventTitle(e)}</div>
                      ))}
                      {evs.length > 3 && <div className="text-[11px] text-slate-400">+{evs.length - 3} weitere</div>}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Terminliste */}
      <h2 className="mb-3 mt-6 text-sm font-semibold text-slate-500 dark:text-slate-400">Alle Termine</h2>
      <Card>
        {events.length === 0 ? <div className="p-5 text-sm text-slate-400">Noch keine Termine geplant.</div> : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={e.type === 'campaign' ? 'amber' : 'green'}>{e.type === 'campaign' ? 'Kampagne' : 'Layout'}</Badge>
                    <span className="truncate font-medium">{eventTitle(e)}</span>
                    {e.priority > 0 && <span className="text-xs text-slate-400">Prio {e.priority}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    → {e.displayName ?? e.groupName ?? '—'} · {fmt(e.fromDt)} {e.toDt ? `– ${fmt(e.toDt)}` : '(offen)'}
                    {e.recurrence?.startTime && ` · täglich ${e.recurrence.startTime}–${e.recurrence.endTime}`}
                  </div>
                </div>
                <button onClick={async () => { if (confirm('Termin löschen?')) { await api.del(`/schedules/${e.id}`).catch((x: any) => setErr(x.message)); load() } }}
                  className="rounded p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"><IconTrash className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {modal !== null && <EventModal preset={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
function EventModal({ preset, onClose, onSaved }: { preset: string; onClose: () => void; onSaved: () => void }) {
  useEscape(onClose)
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [groups, setGroups] = useState<DisplayGroup[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [contentType, setContentType] = useState<'layout' | 'campaign'>('layout')
  const [contentId, setContentId] = useState('')
  const [targetType, setTargetType] = useState<'display' | 'group'>('display')
  const [targetId, setTargetId] = useState('')
  const [fromDt, setFromDt] = useState(preset || defaultFrom())
  const [toDt, setToDt] = useState('')
  const [priority, setPriority] = useState(0)
  const [daypart, setDaypart] = useState(false)
  const [byDay, setByDay] = useState<number[]>([])
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('18:00')

  useEffect(() => {
    api.get<{ layouts: Layout[] }>('/layouts').then((r) => setLayouts(r.layouts)).catch((e: any) => notify(e.message))
    api.get<{ campaigns: Campaign[] }>('/campaigns').then((r) => setCampaigns(r.campaigns)).catch((e: any) => notify(e.message))
    api.get<{ displays: Display[] }>('/displays').then((r) => setDisplays(r.displays)).catch((e: any) => notify(e.message))
    api.get<{ groups: DisplayGroup[] }>('/display-groups').then((r) => setGroups(r.groups)).catch((e: any) => notify(e.message))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      await api.post('/schedules', {
        name: name || 'Termin',
        type: contentType,
        layoutId: contentType === 'layout' ? contentId : null,
        campaignId: contentType === 'campaign' ? contentId : null,
        displayId: targetType === 'display' ? targetId : null,
        displayGroupId: targetType === 'group' ? targetId : null,
        fromDt: new Date(fromDt).toISOString(),
        toDt: toDt ? new Date(toDt).toISOString() : null,
        priority: Number(priority),
        recurrence: daypart ? { byDay, startTime, endTime } : null,
      })
      onSaved()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const input = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="my-8 w-full max-w-lg space-y-4 rounded-xl bg-white p-6 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Termin anlegen</h2>
        {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div>}

        <div>
          <label className="mb-1 block text-sm font-medium">Bezeichnung</label>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Empfang Wochenende" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Inhalt</label>
            <select className={input} value={contentType} onChange={(e) => { setContentType(e.target.value as any); setContentId('') }}>
              <option value="layout">Layout</option>
              <option value="campaign">Kampagne</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{contentType === 'layout' ? 'Layout' : 'Kampagne'}</label>
            <select className={input} value={contentId} onChange={(e) => setContentId(e.target.value)} required>
              <option value="">Auswählen…</option>
              {(contentType === 'layout' ? layouts : campaigns).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Ziel</label>
            <select className={input} value={targetType} onChange={(e) => { setTargetType(e.target.value as any); setTargetId('') }}>
              <option value="display">Display</option>
              <option value="group">Gruppe</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{targetType === 'display' ? 'Display' : 'Gruppe'}</label>
            <select className={input} value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
              <option value="">Auswählen…</option>
              {(targetType === 'display' ? displays : groups).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Von</label>
            <input type="datetime-local" className={input} value={fromDt} onChange={(e) => setFromDt(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Bis (optional)</label>
            <input type="datetime-local" className={input} value={toDt} onChange={(e) => setToDt(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Priorität</label>
          <input type="number" className={input} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
          <p className="mt-1 text-xs text-slate-400">Höhere Priorität gewinnt bei Überschneidung.</p>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={daypart} onChange={(e) => setDaypart(e.target.checked)} />
            Nur zu bestimmten Zeiten (Dayparting)
          </label>
          {daypart && (
            <div className="mt-3 space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap gap-1.5">
                {WD.map((d, i) => {
                  const val = WD_IDX[i]
                  const on = byDay.includes(val)
                  return (
                    <button type="button" key={d} onClick={() => setByDay((b) => on ? b.filter((x) => x !== val) : [...b, val])}
                      className={`h-8 w-8 rounded-md text-xs font-medium cursor-pointer ${on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{d}</button>
                  )
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs text-slate-500">Startzeit</label><input type="time" className={input} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
                <div><label className="mb-1 block text-xs text-slate-500">Endzeit</label><input type="time" className={input} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Speichern…' : 'Anlegen'}</Button>
        </div>
      </form>
    </div>
  )
}

// ---- Helpers --------------------------------------------------------------
function buildMonth(y: number, m: number): (Date | null)[] {
  const first = new Date(y, m, 1)
  const lead = (first.getDay() + 6) % 7 // Mo=0
  const days = new Date(y, m + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(new Date(y, m, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
function shift(c: { y: number; m: number }, delta: number) {
  const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }
}
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
function eventTitle(e: ScheduleEvent) { return e.name || e.layoutName || e.campaignName || 'Termin' }
function fmt(iso: string) { return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function pad(n: number) { return String(n).padStart(2, '0') }
function toLocalDateTime(d: Date, h: number, min: number) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(min)}` }
function defaultFrom() { const n = new Date(); return toLocalDateTime(n, n.getHours(), 0) }
