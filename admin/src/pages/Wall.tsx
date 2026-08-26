import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type LayoutTree, type PlayerState, type WallDisplay } from '../lib/api'
import { notify, notifyOk } from '../lib/toast'
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Skeleton, StatusDot, cn } from '../components/ui'
import { EmergencyView, RegionMirror } from '../components/render'
import {
  layoutVersionOf, useLayoutTree, useSecondTick, useWallConn, useWallDisplay, useWallSource, useWallSummaries,
  type WallSummary,
} from '../lib/wall'

// ---------------------------------------------------------------------------
// Wall — alle Displays als Live-Miniplayer.
//
// Grundlage jeder Kachel ist die Zustandsmeldung des Geraets (welches Layout,
// welches Widget je Region, welche Fehler) ueber dessen bestehende WS-Verbindung.
// Gerendert wird mit DEMSELBEN Renderer wie im Player (components/render.tsx) —
// deshalb ist die Kachel nachweislich das, was das Geraet abspielt.
// Es ist ausdruecklich KEIN Bildschirmfoto; die Seite sagt das auch so.
// ---------------------------------------------------------------------------

type Filter = 'alle' | 'online' | 'offline' | 'fehler' | 'freigabe'
type Sort = 'probleme' | 'name'
type Size = 'klein' | 'mittel' | 'gross'

const GRID: Record<Size, string> = {
  klein: 'grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6',
  mittel: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
  gross: 'grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3',
}

const QUELLE: Record<string, string> = {
  schedule: 'Zeitplan', default: 'Standard', override: 'Sofort-Einblendung', none: 'kein Inhalt',
}

const chip = 'rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors duration-150'
const chipOn = 'bg-brand-600 text-white'
const chipOff = 'border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'

function uhrzeit(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function statusOf(d: { authorized: boolean; online: boolean }): 'online' | 'offline' | 'pending' {
  if (!d.authorized) return 'pending'
  return d.online ? 'online' : 'offline'
}

/** Frischeanzeige: ehrlich benennen, wie alt die Meldung ist — und ob sie ueberhaupt kommt. */
function frische(d: WallDisplay, now: number): { text: string; cls: string; dot: string | null } {
  if (!d.online) {
    return {
      text: d.offlineSince ? `Offline seit ${uhrzeit(d.offlineSince)}` : 'Offline',
      cls: 'text-slate-400',
      dot: null,
    }
  }
  if (!d.receivedAt) return { text: 'meldet noch nichts', cls: 'text-slate-400', dot: null }
  const s = Math.max(0, Math.round((now - d.receivedAt) / 1000))
  if (d.stale) return { text: `meldet seit ${s} s nichts`, cls: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' }
  return { text: `gemeldet vor ${s} s`, cls: 'text-slate-500 dark:text-slate-400', dot: 'bg-emerald-500' }
}

export default function WallPage() {
  const { loading, error } = useWallSource()
  const conn = useWallConn()
  const summaries = useWallSummaries()

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('alle')
  const [sort, setSort] = useState<Sort>('probleme')
  const [size, setSize] = useState<Size>('mittel')
  const [openId, setOpenId] = useState<string | null>(null)

  const counts = useMemo(() => ({
    alle: summaries.length,
    online: summaries.filter((s) => s.online).length,
    offline: summaries.filter((s) => !s.online).length,
    fehler: summaries.filter((s) => s.errorCount > 0).length,
    freigabe: summaries.filter((s) => !s.authorized).length,
  }), [summaries])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = summaries.filter((s) => {
      if (needle && !s.name.toLowerCase().includes(needle)) return false
      if (filter === 'online') return s.online
      if (filter === 'offline') return !s.online
      if (filter === 'fehler') return s.errorCount > 0
      if (filter === 'freigabe') return !s.authorized
      return true
    })
    const rang = (s: WallSummary) => (s.errorCount > 0 ? 0 : !s.online ? 1 : s.stale ? 2 : 3)
    list = [...list].sort((a, b) => (sort === 'name'
      ? a.name.localeCompare(b.name, 'de')
      : (rang(a) - rang(b)) || a.name.localeCompare(b.name, 'de')))
    return list
  }, [summaries, q, filter, sort])

  const openIdx = openId ? shown.findIndex((s) => s.id === openId) : -1
  const step = (delta: number) => {
    if (shown.length === 0) return
    const next = openIdx < 0 ? 0 : (openIdx + delta + shown.length) % shown.length
    setOpenId(shown[next].id)
  }

  return (
    <div>
      <PageHeader
        title="Wall"
        subtitle="Alle Displays als Live-Miniplayer — der Zustand kommt vom Gerät selbst"
        action={
          <div className="flex items-center gap-3">
            <ConnBadge conn={conn} />
            <div className="hidden items-center gap-1 sm:flex">
              {(['klein', 'mittel', 'gross'] as Size[]).map((s) => (
                <button key={s} type="button" onClick={() => setSize(s)}
                  className={cn(chip, size === s ? chipOn : chipOff)}>
                  {s === 'gross' ? 'Groß' : s === 'mittel' ? 'Mittel' : 'Klein'}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
        <b>Kein Bildschirmfoto.</b> Jedes Gerät meldet über seine Dauerverbindung im Sekundentakt, welches Layout und
        welches Widget es gerade in welcher Region abspielt. Das CMS baut daraus mit demselben Renderer nach, den auch
        der Player benutzt — die Kachel zeigt also, was das Gerät laut eigener Meldung tatsächlich wiedergibt,
        inklusive gemeldeter Wiedergabefehler. Echte Pixel-Screenshots benötigen den Geräteagenten;
        die Kiosk-Geräte (Edge/Assigned Access) können keine liefern.
      </div>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Display suchen…"
          className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
        {([['alle', 'Alle'], ['online', 'Online'], ['offline', 'Offline'], ['fehler', 'Mit Fehler'], ['freigabe', 'Wartet auf Freigabe']] as [Filter, string][]).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={cn(chip, filter === k ? chipOn : chipOff)}>
            {label} <span className="tabular-nums opacity-70">{counts[k]}</span>
          </button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}
          className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
          <option value="probleme">Probleme zuerst</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      {loading && summaries.length === 0 ? (
        <div className={cn('grid gap-4', GRID[size])}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <div className="aspect-video w-full animate-pulse bg-slate-200 dark:bg-slate-800" />
              <div className="p-3"><Skeleton className="h-4 w-2/3" /></div>
            </Card>
          ))}
        </div>
      ) : summaries.length === 0 ? (
        <EmptyState title="Noch keine Displays" hint="Sobald ein Player-Client startet (/player), taucht er hier auf." />
      ) : shown.length === 0 ? (
        <EmptyState title="Kein Display passt zum Filter"
          action={<Button variant="ghost" onClick={() => { setQ(''); setFilter('alle') }}>Filter zurücksetzen</Button>} />
      ) : (
        <div className={cn('grid gap-4', GRID[size])}>
          {shown.map((s) => <Tile key={s.id} id={s.id} onOpen={() => setOpenId(s.id)} />)}
        </div>
      )}

      {openId && <Detail id={openId} onClose={() => setOpenId(null)} onStep={step} />}
    </div>
  )
}

function ConnBadge({ conn }: { conn: ReturnType<typeof useWallConn> }) {
  if (conn === 'live') {
    return <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><span className="h-2 w-2 rounded-full bg-emerald-500" />Live-Verbindung</span>
  }
  if (conn === 'poll') {
    return <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"><span className="h-2 w-2 rounded-full bg-amber-500" />Live-Verbindung gestört — Ansicht aktualisiert alle 5 s</span>
  }
  return <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />verbindet…</span>
}

// --- Kachel ----------------------------------------------------------------

function Tile({ id, onOpen }: { id: string; onOpen: () => void }) {
  const d = useWallDisplay(id)
  const now = useSecondTick()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden')

  // Stufe B: ausserhalb des Sichtfelds oder im Hintergrund-Tab wird NICHTS geladen —
  // keine Medien-Requests, keine Timer. Nur so bleiben 30 Kacheln bezahlbar.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    const h = () => setPageVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [])

  const active = inView && pageVisible
  const st = d?.state ?? null
  const tree = useLayoutTree(active && (st?.mode === 'layout' || st?.mode === 'campaign') ? st.layout?.id : null, st?.contentVersion)

  if (!d) return null
  const f = frische(d, now)
  const ratio = st?.layout ? `${st.layout.width} / ${st.layout.height}` : '16 / 9'
  const alt = !!(tree && st?.contentVersion && !st.contentVersion.includes(layoutVersionOf(tree)))
  const errs = st?.errors ?? []

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={onOpen} aria-label={`Großansicht von ${d.name}`}
        className="block w-full cursor-pointer rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="truncate text-sm font-medium">{d.name}</span>
          <span className="flex shrink-0 items-center gap-2">
            {!d.authorized && <Badge tone="amber">wartet auf Freigabe</Badge>}
            <StatusDot status={statusOf(d)} />
          </span>
        </div>

        <div ref={boxRef} className="relative w-full overflow-hidden bg-slate-950 ring-1 ring-inset ring-slate-200 dark:ring-slate-800"
          style={{ aspectRatio: ratio }}>
          <div className={cn('absolute inset-0', !d.online && 'grayscale opacity-40')}>
            <TileBody state={st} tree={tree} active={active} />
          </div>

          {!d.online && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/70 px-2 text-center backdrop-blur-[1px]">
              <div>
                <div className="text-sm font-semibold text-white">
                  {d.offlineSince ? `Offline seit ${uhrzeit(d.offlineSince)}` : 'Offline'}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-300">letzter gemeldeter Stand</div>
              </div>
            </div>
          )}

          {errs.length > 0 && (
            <div className="absolute right-2 top-2 rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow"
              title={errs[errs.length - 1].message}>
              {errs.length} {errs.length === 1 ? 'Fehler' : 'Fehler'}
            </div>
          )}
          {st?.playerError && st.mode !== 'error' && (
            <div className="absolute bottom-2 left-2 right-2 truncate rounded-md bg-amber-500/90 px-2 py-0.5 text-[11px] font-medium text-white shadow"
              title={st.playerError}>
              Player meldet: {st.playerError}
            </div>
          )}
          {alt && (
            <div className="absolute left-2 top-2 rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow"
              title="Die gemeldete Inhaltsversion weicht von der aktuellen Fassung im CMS ab.">
              Gerät zeigt noch eine ältere Fassung
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="truncate">
            {st?.layout?.name ?? (st?.mode === 'emergency' ? 'Sofort-Einblendung' : st?.mode === 'pairing' ? 'Kopplung offen' : 'kein Layout')}
            {st?.source && <span className="opacity-70"> · {QUELLE[st.source] ?? st.source}</span>}
            {st?.campaign && <span className="opacity-70"> · {st.campaign.index}/{st.campaign.total}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {st?.layout && <span className="tabular-nums">{st.layout.width}×{st.layout.height}</span>}
            <span className={cn('inline-flex items-center gap-1', f.cls)}>
              {f.dot && <span className={cn('h-1.5 w-1.5 rounded-full', f.dot)} />}{f.text}
            </span>
          </span>
        </div>
      </button>
    </Card>
  )
}

/** Bildinhalt einer Kachel bzw. der Großansicht. `live=true` heisst volles Rendering. */
function TileBody({ state, tree, active, live }: { state: PlayerState | null; tree: LayoutTree | null; active: boolean; live?: boolean }) {
  if (!state) {
    return (
      <div className="grid h-full place-items-center px-3 text-center text-xs text-slate-500">
        <div><Skeleton className="mx-auto mb-2 h-2 w-24" />meldet gleich…</div>
      </div>
    )
  }
  if (state.mode === 'pairing') {
    return (
      <div className="grid h-full place-items-center bg-slate-950 text-center text-white">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-400">Display koppeln</div>
          <div className="mt-1 font-mono text-2xl font-bold tracking-[0.2em]">{state.pairingCode ?? '––––––'}</div>
        </div>
      </div>
    )
  }
  if (state.mode === 'emergency' && state.emergency) {
    return <EmergencyView emergency={state.emergency} />
  }
  if (state.mode === 'error') {
    return (
      <div className="grid h-full place-items-center px-3 text-center text-xs text-red-400">
        {state.playerError ?? 'Der Player meldet einen Fehler.'}
      </div>
    )
  }
  if (state.mode === 'none' || !state.layout) {
    return <div className="grid h-full place-items-center text-xs text-slate-400">Kein Inhalt geplant</div>
  }
  if (!active) {
    // Stufe B: nur der Rahmen, damit sofort klar ist, dass die Kachel geparkt ist.
    return <div className="grid h-full place-items-center text-[11px] text-slate-500">Vorschau pausiert (außerhalb des Sichtfelds)</div>
  }
  if (!tree) {
    return <div className="grid h-full place-items-center text-xs text-slate-500">Layout wird geladen…</div>
  }
  return <MirrorStage tree={tree} regions={state.regions} live={live} />
}

/**
 * Buehne der Kachel: exakt die Stage-Geometrie des Players (Layoutbaum in Originalgroesse,
 * per transform herunterskaliert) — dadurch verhalten sich alle cqmin-Groessen (Uhr, RSS,
 * Wetter) korrekt und die Kachel ist massstabsgetreu.
 */
function MirrorStage({ tree, regions, live }: { tree: LayoutTree; regions: PlayerState['regions']; live?: boolean }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(0)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const fit = () => setScale(el.clientWidth / tree.width)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tree.width])

  const byRegion = new Map(regions.map((r) => [r.id, r]))

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden">
      {scale > 0 && (
        <div style={{ width: tree.width, height: tree.height, transform: `scale(${scale})`, transformOrigin: 'top left', background: tree.backgroundColor, position: 'relative' }}>
          {tree.regions.map((r) => {
            const rep = byRegion.get(r.id)
            return (
              <div key={r.id} style={{ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height, overflow: 'hidden', containerType: 'size', zIndex: r.zIndex }}>
                <RegionMirror region={r} widgetId={rep?.widgetId ?? null} startedAt={rep?.startedAt} still={!live} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Großansicht -----------------------------------------------------------

function Detail({ id, onClose, onStep }: { id: string; onClose: () => void; onStep: (d: number) => void }) {
  const d = useWallDisplay(id)
  const now = useSecondTick()
  const st = d?.state ?? null
  const tree = useLayoutTree(st?.mode === 'layout' || st?.mode === 'campaign' ? st.layout?.id : null, st?.contentVersion)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onStep])

  if (!d) return null
  const f = frische(d, now)
  const ratio = st?.layout ? `${st.layout.width} / ${st.layout.height}` : '16 / 9'
  const errs = st?.errors ?? []

  const reload = async () => {
    try { await api.post(`/displays/${d.id}/command`, { code: 'RELOAD' }); notifyOk('Befehl „Inhalt neu laden" gesendet') }
    catch (e: any) { notify(e.message) }
  }

  return (
    <Modal onClose={onClose} className="max-w-6xl" labelledBy="wall-detail-title">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-3">
          <h2 id="wall-detail-title" className="truncate text-lg font-semibold">{d.name}</h2>
          <StatusDot status={statusOf(d)} />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={cn('hidden text-xs sm:inline', f.cls)}>Nachgebautes Live-Abbild · {f.text}</span>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label="Schließen">✕</button>
        </div>
      </div>

      <div className="max-h-[75vh] overflow-y-auto p-5">
        <div className="relative w-full overflow-hidden rounded-lg bg-slate-950 ring-1 ring-inset ring-slate-800" style={{ aspectRatio: ratio }}>
          <div className={cn('absolute inset-0', !d.online && 'grayscale opacity-40')}>
            <TileBody state={st} tree={tree} active live />
          </div>
          {!d.online && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/70 text-center backdrop-blur-[1px]">
              <div>
                <div className="font-semibold text-white">{d.offlineSince ? `Offline seit ${uhrzeit(d.offlineSince)}` : 'Offline'}</div>
                <div className="mt-0.5 text-xs text-slate-300">letzter gemeldeter Stand — kein Livebild</div>
              </div>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Videos laufen hier zeitsynchron zum Gerät (±1 s, dem Meldeintervall entsprechend). Grundlage ist die
          Zustandsmeldung des Geräts, nicht sein Bildsignal.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
            <div className="mb-2 font-medium">Kenndaten</div>
            <dl className="space-y-1.5">
              <Row k="Modus" v={modusText(st)} />
              <Row k="Quelle" v={st?.source ? (QUELLE[st.source] ?? st.source) : '—'} />
              <Row k="Layout" v={st?.layout ? `${st.layout.name} (${st.layout.width}×${st.layout.height})` : '—'} />
              <Row k="Inhaltsversion" v={<span className="font-mono text-xs">{st?.contentVersion ?? '—'}</span>} />
              <Row k="Fassung aktuell" v={tree && st?.contentVersion
                ? (st.contentVersion.includes(layoutVersionOf(tree))
                  ? <span className="text-emerald-600 dark:text-emerald-400">ja</span>
                  : <span className="text-amber-600 dark:text-amber-400">nein — Gerät zeigt eine ältere Fassung</span>)
                : '—'} />
              <Row k="Sichtfläche Gerät" v={st?.screen?.w ? `${st.screen.w}×${st.screen.h}` : '—'} />
              <Row k="Gemeldete Auflösung" v={d.resolutionW ? `${d.resolutionW}×${d.resolutionH}` : '—'} />
              <Row k="Client-Version" v={d.clientVersion ?? '—'} />
              <Row k="Verbindung laut Gerät" v={st?.conn === 'online' ? 'online' : st?.conn === 'offline' ? 'offline' : '—'} />
              <Row k="Zuletzt gemeldet" v={d.receivedAt ? `${uhrzeit(d.receivedAt)} (${f.text})` : '—'} />
            </dl>
          </div>

          <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
            <div className="mb-2 font-medium">Wiedergabe je Region</div>
            {!tree || !st || st.regions.length === 0 ? (
              <div className="text-xs text-slate-400">Das Gerät meldet aktuell kein laufendes Widget.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-left text-slate-400">
                  <tr><th className="pb-1 font-medium">Region</th><th className="pb-1 font-medium">Typ</th><th className="pb-1 font-medium">Inhalt</th><th className="pb-1 text-right font-medium">läuft seit</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {st.regions.map((r) => {
                    const reg = tree.regions.find((x) => x.id === r.id)
                    const w = reg?.playlist?.widgets.find((x) => x.id === r.widgetId)
                    return (
                      <tr key={r.id}>
                        <td className="py-1 pr-2">{reg?.name ?? 'unbekannt'}</td>
                        <td className="py-1 pr-2">{r.widgetType}</td>
                        <td className="py-1 pr-2 truncate">{w?.name || '—'}</td>
                        <td className="py-1 text-right tabular-nums">{Math.max(0, Math.round((now - r.startedAt) / 1000))} s</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mt-5 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <div className="mb-2 text-sm font-medium">Gemeldete Wiedergabefehler (letzte 5)</div>
          {errs.length === 0 ? (
            <div className="text-xs text-slate-400">Keine — das Gerät meldet eine fehlerfreie Wiedergabe.</div>
          ) : (
            <ul className="space-y-1 text-xs">
              {[...errs].reverse().map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span className="text-red-600 dark:text-red-400">
                    [{e.code}] {e.message}
                    <span className="text-slate-400"> · Region {tree?.regions.find((x) => x.id === e.regionId)?.name ?? '—'}</span>
                  </span>
                  <span className="shrink-0 text-slate-400">{uhrzeit(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
          {st?.playerError && <div className="mt-2 text-xs text-red-600 dark:text-red-400">Player-Meldung: {st.playerError}</div>}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={reload} disabled={!d.online}>Inhalt neu laden</Button>
            <Link to="/displays" className="inline-flex items-center rounded-md border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              Zum Display →
            </Link>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <button type="button" onClick={() => onStep(-1)} className="cursor-pointer rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" aria-label="Vorheriges Display">←</button>
            <span>mit ← / → blättern</span>
            <button type="button" onClick={() => onStep(1)} className="cursor-pointer rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" aria-label="Nächstes Display">→</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function modusText(st: PlayerState | null): string {
  if (!st) return '—'
  return {
    layout: 'Layout', campaign: 'Kampagne', emergency: 'Sofort-Einblendung',
    pairing: 'wartet auf Freigabe', none: 'kein Inhalt', error: 'Fehler',
  }[st.mode]
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-slate-500 dark:text-slate-400">{k}</dt><dd className="truncate text-right font-medium">{v}</dd></div>
}
