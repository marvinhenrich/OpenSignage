/**
 * Fluechtige Wiedergabe-Telemetrie der Player: "Was laeuft auf dem Geraet gerade WIRKLICH?"
 *
 * Der Player meldet ueber seine bestehende /ws/player-Verbindung im Sekundentakt (nur bei
 * Aenderung, sonst alle 10 s als Herzschlag) seinen Ausgabe-Zustand. Dieser Zustand wird
 * BEWUSST nur im Arbeitsspeicher gehalten:
 *   - er ist Sekundentakt-Telemetrie, kein Betriebsdatum (das steht in display_logs),
 *   - er waere nach 5 Minuten wertlos, wuerde aber die DB dauerhaft belasten,
 *   - nach einem CMS-Neustart ist die Map leer und fuellt sich binnen 10 s von selbst.
 * Es gibt daher weder ein neues Schemafeld noch eine Migration.
 */
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { displayLogs, regions } from '../db/schema.js'

// --- Protokoll (Spiegel von admin/src/lib/api.ts) -------------------------------------

const errorSchema = z.object({
  regionId: z.string().max(64).nullable().catch(null),
  widgetId: z.string().max(64).nullable().catch(null),
  code: z.enum(['MEDIA_LOAD', 'MEDIA_DECODE', 'FRAME_LOAD', 'CONTENT']).catch('CONTENT'),
  message: z.string().max(200).catch(''),
  at: z.number().finite().catch(0),
})

const stateSchema = z.object({
  mode: z.enum(['pairing', 'layout', 'campaign', 'emergency', 'none', 'error']),
  conn: z.enum(['online', 'offline']).catch('online'),
  contentVersion: z.string().max(400).nullable().catch(null),
  source: z.enum(['schedule', 'default', 'override', 'none']).nullable().catch(null),
  pairingCode: z.string().max(16).nullable().catch(null),
  screen: z.object({
    w: z.number().int().min(0).max(20000).catch(0),
    h: z.number().int().min(0).max(20000).catch(0),
  }).catch({ w: 0, h: 0 }),
  layout: z.object({
    id: z.string().max(64),
    name: z.string().max(120),
    width: z.number().int().min(1).max(20000),
    height: z.number().int().min(1).max(20000),
  }).nullable().catch(null),
  campaign: z.object({
    index: z.number().int().min(0).max(1000),
    total: z.number().int().min(0).max(1000),
  }).nullable().catch(null),
  emergency: z.object({
    text: z.string().max(200).catch(''),
    subtext: z.string().max(200).nullable().catch(null),
    color: z.string().max(40).nullable().catch(null),
    background: z.string().max(40).nullable().catch(null),
  }).nullable().catch(null),
  regions: z.array(z.object({
    id: z.string().max(64),
    widgetId: z.string().max(64),
    widgetType: z.string().max(40),
    startedAt: z.number().finite().catch(0),
  })).max(24).catch([]),
  errors: z.array(errorSchema).max(5).catch([]),
  playerError: z.string().max(200).nullable().catch(null),
})

export type PlayerState = z.infer<typeof stateSchema>
export type PlayerPlayError = z.infer<typeof errorSchema>

/** Ab wann gilt eine Meldung als ueberfaellig? 3x Herzschlag (10 s) - ein verlorener Tick ist erlaubt. */
export const STALE_AFTER_MS = 30_000

interface Entry {
  state: PlayerState | null
  /** Serverzeit des Eingangs - massgeblich, NICHT die (moeglicherweise falsche) Geraeteuhr. */
  receivedAt: number
  /** Geraeteuhr der letzten Meldung, nur zur Anzeige einer Uhren-Abweichung. */
  deviceTs: number
  online: boolean
  onlineSince: number | null
  offlineSince: number | null
  /** Zuletzt ins Betriebs-Log geschriebene Wiedergabefehler: Signatur -> Zeitpunkt. */
  loggedErrors: Map<string, number>
  /** Zaehlfenster fuer die harte Obergrenze der Fehlerprotokollierung. */
  errLogWindowStart: number
  errLogCount: number
}

const states = new Map<string, Entry>()

export interface WallStateRow {
  displayId: string
  state: PlayerState | null
  receivedAt: number | null
  online: boolean
  offlineSince: number | null
  stale: boolean
}

type ChangeKind = 'state' | 'presence' | 'stale'
type Listener = (kind: ChangeKind, displayId: string) => void
const listeners = new Set<Listener>()

/** Schlanke Listener-Registrierung: playerState kennt die Wall nicht (kein Import-Zyklus). */
export function onPlayerStateChange(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(kind: ChangeKind, displayId: string) {
  for (const l of listeners) {
    try { l(kind, displayId) } catch { /* ein defekter Listener darf nichts blockieren */ }
  }
}

function entryOf(displayId: string): Entry {
  let e = states.get(displayId)
  if (!e) {
    e = { state: null, receivedAt: 0, deviceTs: 0, online: false, onlineSince: null, offlineSince: null, loggedErrors: new Map(), errLogWindowStart: 0, errLogCount: 0 }
    states.set(displayId, e)
  }
  return e
}

function isStale(e: Entry): boolean {
  if (!e.online) return false
  const ref = e.receivedAt || e.onlineSince || 0
  if (!ref) return false
  return Date.now() - ref > STALE_AFTER_MS
}

function toRow(displayId: string, e: Entry | undefined): WallStateRow {
  if (!e) return { displayId, state: null, receivedAt: null, online: false, offlineSince: null, stale: false }
  return {
    displayId,
    state: e.state,
    receivedAt: e.receivedAt || null,
    online: e.online,
    offlineSince: e.offlineSince,
    stale: isStale(e),
  }
}

// --- Eingang ---------------------------------------------------------------------------

/**
 * Zustandsmeldung eines Players uebernehmen. Ungueltige Meldungen werden verworfen
 * (kein Throw - der WS-Handler darf daran nicht sterben). Harte Obergrenzen im Schema
 * verhindern, dass ein kompromittiertes Geraet den Speicher des CMS vollschreibt.
 */
export function setPlayerState(displayId: string, raw: unknown): void {
  const parsed = stateSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn(`[wall] Ungueltige Zustandsmeldung von Display ${displayId} verworfen: ${parsed.error.issues[0]?.message ?? 'unbekannt'}`)
    return
  }
  const e = entryOf(displayId)
  const prev = e.state
  e.state = parsed.data
  e.receivedAt = Date.now()
  const ts = (raw as { ts?: unknown })?.ts
  e.deviceTs = typeof ts === 'number' && Number.isFinite(ts) ? ts : 0
  if (!e.online) { e.online = true; e.onlineSince = e.onlineSince ?? Date.now(); e.offlineSince = null }

  void logNewErrors(displayId, e, prev)
  emit('state', displayId)
}

/** Fenster, innerhalb dessen derselbe Fehler nicht erneut ins Betriebs-Log geschrieben wird. */
const ERROR_LOG_DEDUPE_MS = 5 * 60_000
/** Hoechstens so viele Wiedergabefehler je Display und Fenster ins Protokoll. */
const MAX_ERROR_LOGS_PER_WINDOW = 12
/** Notbremse gegen viele verschiedene, geraetegewaehlte Kennungen in der Entprell-Map. */
const MAX_DEDUPE_ENTRIES = 200

async function logNewErrors(displayId: string, e: Entry, prev: PlayerState | null): Promise<void> {
  const errs = e.state?.errors ?? []
  if (errs.length === 0) return
  const prevSigs = new Set((prev?.errors ?? []).map((x) => `${x.widgetId ?? '-'}|${x.code}`))
  const now = Date.now()

  // Harte Obergrenze je Display und Zeitfenster. Die Entprellung unten arbeitet mit einer
  // Signatur aus widgetId+code - die widgetId kommt aber VOM GERAET und ist frei waehlbar.
  // Ein defektes (oder manipuliertes) Geraet koennte mit wechselnden IDs sonst beliebig
  // viele Protokolleintraege und DB-Schreibvorgaenge ausloesen. Diese Grenze deckelt das
  // unabhaengig vom Inhalt der Meldung.
  if (now - e.errLogWindowStart > ERROR_LOG_DEDUPE_MS) { e.errLogWindowStart = now; e.errLogCount = 0 }
  if (e.errLogCount >= MAX_ERROR_LOGS_PER_WINDOW) return

  const fresh = errs.filter((x) => {
    const sig = `${x.widgetId ?? '-'}|${x.code}`
    if (prevSigs.has(sig)) return false
    const last = e.loggedErrors.get(sig)
    if (last && now - last < ERROR_LOG_DEDUPE_MS) return false
    return true
  }).slice(0, Math.max(0, MAX_ERROR_LOGS_PER_WINDOW - e.errLogCount))
  if (fresh.length === 0) return

  // Aufraeumen, damit die Dedupe-Map nicht waechst
  for (const [sig, at] of e.loggedErrors) if (now - at > ERROR_LOG_DEDUPE_MS) e.loggedErrors.delete(sig)
  // Notbremse, falls ein Geraet innerhalb des Fensters sehr viele verschiedene IDs schickt
  if (e.loggedErrors.size > MAX_DEDUPE_ENTRIES) e.loggedErrors.clear()
  e.errLogCount += fresh.length

  // Regionsnamen nachschlagen, damit die Meldung im Display-Protokoll verortbar ist.
  const regionIds = [...new Set(fresh.map((x) => x.regionId).filter((x): x is string => !!x))]
  const nameById = new Map<string, string>()
  if (regionIds.length) {
    try {
      const rows = await db.select({ id: regions.id, name: regions.name }).from(regions).where(inArray(regions.id, regionIds))
      for (const r of rows) nameById.set(r.id, r.name)
    } catch { /* Namen sind Komfort, kein Muss */ }
  }

  for (const x of fresh) {
    e.loggedErrors.set(`${x.widgetId ?? '-'}|${x.code}`, now)
    const reg = x.regionId ? (nameById.get(x.regionId) ?? 'unbekannte Region') : 'ohne Region'
    const type = e.state?.regions.find((r) => r.widgetId === x.widgetId)?.widgetType ?? 'Widget'
    const layoutName = e.state?.layout?.name ? ` (Layout „${e.state.layout.name}")` : ''
    await db.insert(displayLogs).values({
      displayId,
      level: 'error',
      code: 'PLAY_ERROR',
      message: `Wiedergabefehler [${x.code}] bei ${type} in Region „${reg}"${layoutName}: ${x.message || 'ohne Detail'}`,
      detail: { code: x.code, regionId: x.regionId, widgetId: x.widgetId, widgetType: type },
    }).catch(() => { /* Protokoll darf die Telemetrie nicht blockieren */ })
  }
}

// --- Praesenz --------------------------------------------------------------------------

export function markOnline(displayId: string): void {
  const e = entryOf(displayId)
  if (e.online) return
  e.online = true
  e.onlineSince = Date.now()
  e.offlineSince = null
  emit('presence', displayId)
}

/** Offline markieren - der letzte bekannte Zustand bleibt bewusst erhalten (Wall zeigt ihn ausgegraut). */
export function markOffline(displayId: string): void {
  const e = entryOf(displayId)
  if (!e.online && e.offlineSince) return
  e.online = false
  e.onlineSince = null
  e.offlineSince = Date.now()
  emit('presence', displayId)
}

// --- Abfrage ---------------------------------------------------------------------------

export function getWallRow(displayId: string): WallStateRow {
  return toRow(displayId, states.get(displayId))
}

/** Nur Zustaende zu tatsaechlich existierenden Displays - Karteileichen fallen automatisch raus. */
export function getWallSnapshot(ids: string[]): WallStateRow[] {
  return ids.map((id) => toRow(id, states.get(id)))
}

/** Displays, deren Stale-Zustand sich seit dem letzten Aufruf geaendert hat. */
const staleFlags = new Map<string, boolean>()
export function pollStaleChanges(): { displayId: string; stale: boolean }[] {
  const out: { displayId: string; stale: boolean }[] = []
  for (const [id, e] of states) {
    const now = isStale(e)
    if (staleFlags.get(id) !== now) { staleFlags.set(id, now); out.push({ displayId: id, stale: now }) }
  }
  return out
}

// --- Aufraeumen ------------------------------------------------------------------------

const MAX_ENTRIES = 500
const KEEP_OFFLINE_MS = 24 * 3600 * 1000

function sweep(): void {
  const now = Date.now()
  for (const [id, e] of states) {
    if (!e.online && e.offlineSince && now - e.offlineSince > KEEP_OFFLINE_MS) {
      states.delete(id)
      staleFlags.delete(id)
    }
  }
  if (states.size > MAX_ENTRIES) {
    const sorted = [...states.entries()].sort((a, b) => (a[1].receivedAt || 0) - (b[1].receivedAt || 0))
    for (const [id] of sorted.slice(0, states.size - MAX_ENTRIES)) { states.delete(id); staleFlags.delete(id) }
  }
}

const sweepTimer = setInterval(sweep, 300_000)
sweepTimer.unref?.()

/** Beim CMS-Start sind alle Displays getrennt - Altlasten aus einem vorherigen Lauf gibt es nicht. */
export function resetPlayerStates(): void {
  states.clear()
  staleFlags.clear()
}

/** Wird beim Loeschen eines Displays aufgerufen, damit kein verwaister Zustand zurueckbleibt. */
export function forgetDisplay(displayId: string): void {
  states.delete(displayId)
  staleFlags.delete(displayId)
}

/** Hilfsabfrage fuer Routen, die ohne den Player-Manager auskommen wollen. */
export function isOnline(displayId: string): boolean {
  return states.get(displayId)?.online === true
}
