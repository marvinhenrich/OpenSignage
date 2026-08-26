/**
 * Verteiler fuer die Admin-Seite "Wall" (/ws/wall).
 *
 * Haelt die angemeldeten Wall-Ansichten und pusht ihnen jede Zustands-, Praesenz- und
 * Stale-Aenderung der Player. Quelle ist ausschliesslich playerState (RAM) plus die
 * Display-Stammdaten aus der DB - kein Polling, kein neues Schemafeld.
 */
import type { WebSocket } from 'ws'
import { desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { displays } from '../db/schema.js'
import { getWallRow, getWallSnapshot, onPlayerStateChange, pollStaleChanges } from './playerState.js'

const peers = new Set<WebSocket>()

function send(ws: WebSocket, msg: unknown) {
  try {
    if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(msg))
  } catch { /* ignorieren */ }
}

function broadcast(msg: unknown) {
  for (const ws of peers) send(ws, msg)
}

/** Stammdaten + gemeldeter Zustand aller Displays - fuer den ersten Paint und den Notnagel-Poll. */
export async function buildWallSnapshot() {
  const rows = await db.select({
    id: displays.id, name: displays.name, authorized: displays.authorized, status: displays.status,
    lastSeenAt: displays.lastSeenAt, resolutionW: displays.resolutionW, resolutionH: displays.resolutionH,
    clientVersion: displays.clientVersion,
  }).from(displays).orderBy(desc(displays.createdAt))

  const byId = new Map(getWallSnapshot(rows.map((r) => r.id)).map((s) => [s.displayId, s]))
  return {
    ts: Date.now(),
    displays: rows.map((r) => {
      const s = byId.get(r.id)
      return {
        id: r.id,
        name: r.name,
        authorized: r.authorized,
        status: r.status as 'online' | 'offline' | 'pending',
        lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : null,
        resolutionW: r.resolutionW,
        resolutionH: r.resolutionH,
        clientVersion: r.clientVersion,
        state: s?.state ?? null,
        receivedAt: s?.receivedAt ?? null,
        online: s?.online ?? false,
        offlineSince: s?.offlineSince ?? null,
        stale: s?.stale ?? false,
      }
    }),
  }
}

export async function addWallPeer(ws: WebSocket): Promise<void> {
  peers.add(ws)
  send(ws, { type: 'wall-snapshot', ...(await buildWallSnapshot()) })
}

export function removeWallPeer(ws: WebSocket): void {
  peers.delete(ws)
}

export function wallPeerCount(): number {
  return peers.size
}

/** Aenderung an den Display-Stammdaten (Freigabe, Umbenennen, Loeschen) -> Wall laedt neu. */
export function notifyWallDisplaysChanged(): void {
  broadcast({ type: 'wall-displays-changed', ts: Date.now() })
}

// --- Fan-out mit Drossel ---------------------------------------------------------------

/** Der Player koalesziert bereits auf 1 s; das hier ist die Absicherung gegen Ausreisser. */
const THROTTLE_MS = 1000
const lastSent = new Map<string, number>()
const pending = new Map<string, ReturnType<typeof setTimeout>>()

function pushState(displayId: string) {
  if (peers.size === 0) return
  const now = Date.now()
  const last = lastSent.get(displayId) ?? 0
  const wait = last + THROTTLE_MS - now
  if (wait > 0) {
    if (pending.has(displayId)) return
    const t = setTimeout(() => { pending.delete(displayId); pushState(displayId) }, wait)
    t.unref?.()
    pending.set(displayId, t)
    return
  }
  lastSent.set(displayId, now)
  const row = getWallRow(displayId)
  broadcast({ type: 'wall-state', displayId, state: row.state, receivedAt: row.receivedAt, online: row.online, stale: row.stale })
}

function pushPresence(displayId: string) {
  if (peers.size === 0) return
  const row = getWallRow(displayId)
  broadcast({
    type: 'wall-presence', displayId,
    online: row.online, offlineSince: row.offlineSince, stale: row.stale,
    lastSeenAt: new Date().toISOString(),
  })
}

onPlayerStateChange((kind, displayId) => {
  if (kind === 'state') pushState(displayId)
  else pushPresence(displayId)
})

// --- Takte -----------------------------------------------------------------------------

/** Stale-Uebergaenge pruefen: die Kachel schaltet auch dann um, wenn das Geraet nichts mehr sendet. */
const staleTimer = setInterval(() => {
  if (peers.size === 0) return
  for (const c of pollStaleChanges()) broadcast({ type: 'wall-stale', displayId: c.displayId, stale: c.stale })
}, 5_000)
staleTimer.unref?.()

/** Heartbeat wie beim Player: App-Ping haelt Proxy-Timeouts offen, ws.ping() erkennt tote Peers. */
const pingTimer = setInterval(() => {
  for (const ws of peers) {
    if ((ws as unknown as { isAlive?: boolean }).isAlive === false) { try { ws.terminate() } catch { /* ignorieren */ } ; continue }
    ;(ws as unknown as { isAlive?: boolean }).isAlive = false
    try { ws.ping() } catch { /* ignorieren */ }
    send(ws, { type: 'ping', ts: Date.now() })
  }
}, 30_000)
pingTimer.unref?.()
