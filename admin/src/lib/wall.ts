/**
 * Datenschicht der Wall.
 *
 * Live-Push per WebSocket (/ws/wall) ist der Normalbetrieb — passend zum Kernversprechen
 * „Live statt Polling". Der REST-Snapshot wird nur zweimal gebraucht:
 *   1. erster Paint, damit das Raster steht, waehrend der WS-Handshake noch laeuft,
 *   2. Notnagel, falls der WS-Aufbau zweimal hintereinander scheitert (z. B. ein
 *      Reverse-Proxy, der /ws/ nicht durchreicht) — dann alle 5 s, sichtbar beschriftet.
 *
 * Der Zustand liegt in EINER Map ausserhalb von React; jede Kachel abonniert per
 * useSyncExternalStore nur ihren eigenen Eintrag. Eine Zustandsmeldung rendert damit
 * genau eine Kachel neu statt des gesamten Rasters.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api, type LayoutTree, type WallDisplay, type WallSnapshot } from './api'

export type WallConn = 'verbindet' | 'live' | 'poll'

const displays = new Map<string, WallDisplay>()
let order: string[] = []
const tileSubs = new Map<string, Set<() => void>>()
const summarySubs = new Set<() => void>()
const connSubs = new Set<() => void>()
let conn: WallConn = 'verbindet'

/** Grobdaten fuer Filter, Sortierung und Zaehler — bewusst OHNE das laufende Widget. */
export interface WallSummary {
  id: string
  name: string
  authorized: boolean
  online: boolean
  stale: boolean
  errorCount: number
  offlineSince: number | null
}
let summaries: WallSummary[] = []
let summarySig = ''

function notifyTile(id: string) {
  const s = tileSubs.get(id)
  if (s) for (const cb of s) cb()
}
function setConn(next: WallConn) {
  if (conn === next) return
  conn = next
  for (const cb of connSubs) cb()
}

/**
 * Grobdaten neu berechnen. Sie aendern sich nur bei Praesenz-, Fehler- oder Stammdaten-
 * wechseln — ein blosser Widget-Wechsel rendert daher NUR die betroffene Kachel neu,
 * nicht das ganze Raster.
 */
function recomputeSummaries() {
  const next: WallSummary[] = []
  for (const id of order) {
    const d = displays.get(id)
    if (!d) continue
    next.push({
      id: d.id, name: d.name, authorized: d.authorized,
      online: d.online, stale: d.stale,
      errorCount: d.state?.errors.length ?? 0,
      offlineSince: d.offlineSince,
    })
  }
  const sig = next.map((s) => `${s.id}:${s.name}:${s.authorized}:${s.online}:${s.stale}:${s.errorCount}:${s.offlineSince}`).join('|')
  if (sig === summarySig) return
  summarySig = sig
  summaries = next
  for (const cb of summarySubs) cb()
}

function applySnapshot(snap: WallSnapshot) {
  const nextOrder = snap.displays.map((d) => d.id)
  for (const d of snap.displays) {
    const prev = displays.get(d.id)
    if (!prev || JSON.stringify(prev) !== JSON.stringify(d)) { displays.set(d.id, d); notifyTile(d.id) }
  }
  for (const id of [...displays.keys()]) if (!nextOrder.includes(id)) displays.delete(id)
  order = nextOrder
  recomputeSummaries()
}

function patchTile(id: string, patch: Partial<WallDisplay>) {
  const prev = displays.get(id)
  if (!prev) return
  const next = { ...prev }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (next as any)[k] = v
  displays.set(id, next)
  notifyTile(id)
  recomputeSummaries()
}

// --- React-Anbindung -------------------------------------------------------------------

/** Abo genau einer Kachel. */
export function useWallDisplay(id: string): WallDisplay | undefined {
  const subscribe = useCallback((cb: () => void) => {
    let set = tileSubs.get(id)
    if (!set) { set = new Set(); tileSubs.set(id, set) }
    set.add(cb)
    return () => { const s = tileSubs.get(id); if (s) { s.delete(cb); if (s.size === 0) tileSubs.delete(id) } }
  }, [id])
  return useSyncExternalStore(subscribe, () => displays.get(id), () => displays.get(id))
}

function subscribeSummaries(cb: () => void) { summarySubs.add(cb); return () => { summarySubs.delete(cb) } }
function subscribeConn(cb: () => void) { connSubs.add(cb); return () => { connSubs.delete(cb) } }

/** Grobdaten aller Displays (neueste zuerst, wie auf der Displays-Seite). */
export function useWallSummaries(): WallSummary[] {
  return useSyncExternalStore(subscribeSummaries, () => summaries, () => summaries)
}

export function useWallConn(): WallConn {
  return useSyncExternalStore(subscribeConn, () => conn, () => conn)
}

/**
 * Baut Verbindung + Erst-Snapshot auf. Genau einmal pro Seite aufrufen.
 * Liefert Ladezustand und einen ggf. aufgetretenen Fehler.
 */
export function useWallSource(): { loading: boolean; error: string } {
  const [loading, setLoading] = useState(displays.size === 0)
  const [error, setError] = useState('')
  const errRef = useRef(setError)
  errRef.current = setError

  useEffect(() => {
    let closed = false
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let watchdog: ReturnType<typeof setInterval> | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let failures = 0
    let lastRx = Date.now()
    const DEAD_AFTER_MS = 90_000

    const loadSnapshot = async () => {
      try {
        const snap = await api.get<WallSnapshot>('/displays/wall')
        if (closed) return
        applySnapshot(snap)
        errRef.current('')
      } catch (e: any) {
        if (!closed) errRef.current(e?.message ?? 'Snapshot konnte nicht geladen werden')
      } finally {
        if (!closed) setLoading(false)
      }
    }

    const startPolling = () => {
      if (poll) return
      setConn('poll')
      poll = setInterval(() => { void loadSnapshot() }, 5000)
    }
    const stopPolling = () => { if (poll) { clearInterval(poll); poll = null } }

    void loadSnapshot()

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws/wall`)
      ws.onopen = () => {
        failures = 0
        lastRx = Date.now()
        stopPolling()
        setConn('live')
        watchdog = setInterval(() => {
          if (Date.now() - lastRx > DEAD_AFTER_MS) { try { ws?.close() } catch { /* ignorieren */ } }
        }, 15000)
      }
      ws.onmessage = (ev) => {
        lastRx = Date.now()
        try {
          const m = JSON.parse(ev.data)
          if (m.type === 'wall-snapshot') { applySnapshot(m as WallSnapshot); setLoading(false) }
          // `status` wird bewusst nicht angefasst — die Kachel leitet ihn aus
          // authorized/online ab, sonst wuerde ein wartendes Display faelschlich „online" heissen.
          else if (m.type === 'wall-state') patchTile(m.displayId, { state: m.state, receivedAt: m.receivedAt, online: m.online, stale: m.stale })
          else if (m.type === 'wall-presence') patchTile(m.displayId, { online: m.online, offlineSince: m.offlineSince, stale: m.stale, lastSeenAt: m.lastSeenAt })
          else if (m.type === 'wall-stale') patchTile(m.displayId, { stale: m.stale })
          else if (m.type === 'wall-displays-changed') void loadSnapshot()
        } catch { /* ignorieren */ }
      }
      ws.onclose = () => {
        if (watchdog) { clearInterval(watchdog); watchdog = null }
        if (closed) return
        failures += 1
        setConn('verbindet')
        // Erst nach dem zweiten Fehlschlag auf Polling ausweichen — kurze Aussetzer
        // (Server-Neustart, WLAN-Hopser) sollen nicht sofort den Notbetrieb ausloesen.
        if (failures >= 2) startPolling()
        retry = setTimeout(connect, 4000)
      }
      ws.onerror = () => { try { ws?.close() } catch { /* ignorieren */ } }
    }
    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      if (watchdog) clearInterval(watchdog)
      stopPolling()
      try { ws?.close() } catch { /* ignorieren */ }
      setConn('verbindet')
    }
  }, [])

  return { loading, error }
}

// --- Sekundentakt fuer die Frischeanzeige ----------------------------------------------

// EIN Takt fuer die ganze Seite statt eines Timers je Kachel.
let tickNow = Date.now()
const tickSubs = new Set<() => void>()
let tickTimer: ReturnType<typeof setInterval> | null = null

function subscribeTick(cb: () => void) {
  tickSubs.add(cb)
  if (!tickTimer) {
    tickTimer = setInterval(() => { tickNow = Date.now(); for (const f of tickSubs) f() }, 1000)
  }
  return () => {
    tickSubs.delete(cb)
    if (tickSubs.size === 0 && tickTimer) { clearInterval(tickTimer); tickTimer = null }
  }
}

/** Aktuelle Zeit im Sekundentakt (fuer „gemeldet vor X s"). */
export function useSecondTick(): number {
  return useSyncExternalStore(subscribeTick, () => tickNow, () => tickNow)
}

// --- Layoutbaum-Cache ------------------------------------------------------------------

const MAX_TREES = 40
const trees = new Map<string, LayoutTree>()
const inflight = new Map<string, Promise<LayoutTree | null>>()

/** Versionsformel des Servers (server/src/lib/resolve.ts) — fuer den Fassungs-Abgleich. */
export function layoutVersionOf(t: LayoutTree): string {
  return `${t.id}:${t.publishedVersion ?? 0}:${new Date(t.updatedAt).getTime()}`
}

async function fetchTree(key: string, layoutId: string): Promise<LayoutTree | null> {
  const running = inflight.get(key)
  if (running) return running
  const p = api.get<{ layout: LayoutTree }>(`/layouts/${layoutId}`)
    .then((r) => {
      trees.set(key, r.layout)
      if (trees.size > MAX_TREES) { const oldest = trees.keys().next().value; if (oldest) trees.delete(oldest) }
      return r.layout
    })
    .catch(() => null)
    .finally(() => { inflight.delete(key) })
  inflight.set(key, p)
  return p
}

/**
 * Layoutbaum zu einem gemeldeten Zustand. Schluessel ist Layout + gemeldete Inhaltsversion:
 * zwoelf Displays mit demselben Layout laden den Baum genau EINMAL, und meldet ein Geraet
 * eine neue Version, wird sie genau einmal nachgeladen.
 */
export function useLayoutTree(layoutId: string | null | undefined, contentVersion: string | null | undefined): LayoutTree | null {
  const key = layoutId ? `${layoutId}@${contentVersion ?? ''}` : ''
  const [tree, setTree] = useState<LayoutTree | null>(() => (key ? trees.get(key) ?? null : null))

  useEffect(() => {
    if (!key || !layoutId) { setTree(null); return }
    const cached = trees.get(key)
    if (cached) { setTree(cached); return }
    let alive = true
    void fetchTree(key, layoutId).then((t) => { if (alive) setTree(t) })
    return () => { alive = false }
  }, [key, layoutId])

  return tree
}
