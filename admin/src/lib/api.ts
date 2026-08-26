// Schmaler API-Client. Cookies (Session) werden mitgesendet.
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public ref?: string) {
    super(message)
  }
}

function toError(status: number, data: any): ApiError {
  let msg = data?.error ?? `Fehler ${status}`
  if (data?.ref) msg += ` (Ref. ${data.ref})`
  else if (data?.code && data.code !== 'BAD_REQUEST') msg += ` [${data.code}]`
  return new ApiError(status, msg, data?.code, data?.ref)
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, credentials: 'include', headers: {} }
  if (body !== undefined) {
    opts.headers = { 'content-type': 'application/json' }
    opts.body = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, opts)
  } catch (e) {
    throw new ApiError(0, 'Server nicht erreichbar (Netzwerkfehler)', 'NETWORK')
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw toError(res.status, data)
  return data as T
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b),
  patch: <T>(p: string, b?: unknown) => req<T>('PATCH', p, b),
  put: <T>(p: string, b?: unknown) => req<T>('PUT', p, b),
  del: <T>(p: string) => req<T>('DELETE', p),
  async upload<T>(p: string, form: FormData): Promise<T> {
    let res: Response
    try {
      res = await fetch(`/api${p}`, { method: 'POST', credentials: 'include', body: form })
    } catch (e) {
      throw new ApiError(0, 'Server nicht erreichbar (Netzwerkfehler)', 'NETWORK')
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) throw toError(res.status, data)
    return data as T
  },
}

// Typen (Spiegel des Backends)
export type Role = 'admin' | 'grafik' | 'operator' | 'viewer'
export interface User { id: string; username: string; role: Role }
export interface Media {
  id: string; name: string; type: 'image' | 'video' | 'audio' | 'pdf' | 'font'
  storageKey: string; mimeType?: string; sizeBytes?: number; createdAt: string; usageCount?: number
}
export interface Layout {
  id: string; name: string; description?: string | null; width: number; height: number
  status: 'draft' | 'published' | 'archived'; updatedAt: string
}
export type WidgetType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'clock' | 'weather' | 'rss' | 'webpage' | 'embedded_html' | 'icinga'
export interface Widget {
  id: string; type: WidgetType; name?: string | null; mediaId?: string | null
  durationSeconds: number; orderIndex: number; enabled?: boolean; options?: Record<string, unknown>
  mediaStorageKey?: string | null; mediaType?: string | null; mediaMime?: string | null
}
export interface Playlist { id: string; name: string; widgets: Widget[] }
export interface Region {
  id: string; name: string; x: number; y: number; width: number; height: number
  zIndex: number; playlist: Playlist | null
}
export interface LayoutTree extends Layout {
  backgroundColor: string; regions: Region[]; publishedVersion?: number
}

/**
 * Vom Geraet gemeldeter Wiedergabezustand (Spiegel von server/src/ws/playerState.ts).
 * Das ist KEIN Bildschirmfoto, sondern der Ausgabe-Zustand des Renderers am Geraet.
 */
export type PlayerPlayErrorCode = 'MEDIA_LOAD' | 'MEDIA_DECODE' | 'FRAME_LOAD' | 'CONTENT'
export interface PlayerPlayError {
  regionId: string | null
  widgetId: string | null
  code: PlayerPlayErrorCode
  message: string
  at: number
}
export interface PlayerState {
  mode: 'pairing' | 'layout' | 'campaign' | 'emergency' | 'none' | 'error'
  conn: 'online' | 'offline'
  contentVersion: string | null
  source: 'schedule' | 'default' | 'override' | 'none' | null
  pairingCode: string | null
  screen: { w: number; h: number }
  layout: { id: string; name: string; width: number; height: number } | null
  campaign: { index: number; total: number } | null
  emergency: { text: string; subtext?: string | null; color?: string | null; background?: string | null } | null
  regions: { id: string; widgetId: string; widgetType: string; startedAt: number }[]
  errors: PlayerPlayError[]
  playerError: string | null
}

/** Eine Kachel der Wall: Display-Stammdaten + gemeldeter Zustand + Frische. */
export interface WallDisplay {
  id: string
  name: string
  authorized: boolean
  status: 'online' | 'offline' | 'pending'
  lastSeenAt: string | null
  resolutionW: number | null
  resolutionH: number | null
  clientVersion: string | null
  state: PlayerState | null
  /** Serverzeit (ms) des letzten Zustands-Eingangs — massgeblich, nicht die Geraeteuhr. */
  receivedAt: number | null
  online: boolean
  offlineSince: number | null
  stale: boolean
}
export interface WallSnapshot { ts: number; displays: WallDisplay[] }

export interface DisplayGroup { id: string; name: string; description?: string | null; memberCount?: number }
export interface Campaign { id: string; name: string; layoutCount?: number }
export interface CampaignLayout { layoutId: string; orderIndex: number; name: string; status: string }
export interface ScheduleEvent {
  id: string; name: string; type: 'layout' | 'campaign' | 'overlay' | 'command'
  layoutId?: string | null; campaignId?: string | null
  displayId?: string | null; displayGroupId?: string | null
  fromDt: string; toDt?: string | null; priority: number; isOverlay: boolean
  recurrence?: { byDay?: number[]; startTime?: string; endTime?: string } | null
  layoutName?: string | null; campaignName?: string | null
  displayName?: string | null; groupName?: string | null
}

/**
 * Monitoring-Zusammenfassung der Icinga-Kachel (Spiegel von server/src/routes/icinga.ts).
 * Der CMS-Server holt die Daten per Icinga-2-API; die Displays brauchen selbst KEINEN
 * Zugang ins Monitoring-Netz. Zwei Quellen, gleiche Antwort:
 *   - `/api/icinga`                    Admin-Vorschau (Sitzungscookie, nur Rolle admin)
 *   - `/api/player/icinga?key=<hwKey>` Player (Fernseher ohne Sitzung)
 */
export type IcingaState = 'ok' | 'warning' | 'critical' | 'unknown'
/** Zustand einer offenen Meldung — Dienste UND Hosts (Hosts liefern down/unreachable). */
export type IcingaProblemState = 'warning' | 'critical' | 'unknown' | 'down' | 'unreachable'
export interface IcingaProblem {
  /** Ein ausgefallener Host ist etwas anderes als ein roter Dienst — die Kachel trennt das. */
  kind: 'host' | 'service'
  host: string
  /** Leer, wenn es den Host selbst betrifft. */
  service: string
  /** Lesbare Bezeichnung des Pruefnamens (Server: prettyCheckName). */
  label: string
  state: IcingaProblemState
  /** Zeitpunkt des Statuswechsels (ms, Serverzeit). */
  since: number
  output: string
}
/**
 * Zahlen je Host-/Servicegruppe. Der Server liefert ALLE Gruppen (betroffene zuerst),
 * nicht nur die mit Problemen: sonst wäre die Gruppenansicht im Normalbetrieb leer —
 * und genau dann soll das Wallboard zeigen, dass die Anlage steht („WLAN 100/100").
 */
export interface IcingaGroup {
  name: string
  critical: number
  warning: number
  down: number
  /** Objekte der Gruppe, die in Ordnung sind — Grundlage des Füllbalkens. */
  ok: number
  total: number
}
/** Eine Meldung, um die sich bereits jemand kümmert (bestätigt). */
export interface IcingaAcknowledged {
  kind: 'host' | 'service'
  host: string
  service: string
  /** Lesbare Bezeichnung des Pruefnamens. */
  label: string
  state: IcingaProblemState
  since: number
}
/** Was sich in der letzten Stunde von selbst gefangen hat — zeigt Bewegung im Ruhezustand. */
export interface IcingaRecovered {
  kind: 'host' | 'service'
  host: string
  service: string
  /** Lesbare Bezeichnung des Pruefnamens. */
  label: string
  /** Pruefausgabe von Icinga - die eigentlich lesbare Meldung. */
  output: string
  /** Zeitpunkt der Erholung (ms, Serverzeit). */
  at: number
}
/** Ein Punkt des Verlaufs (alle 30 s einer, bis 4 Stunden zurück). */
export interface IcingaHistoryPoint {
  t: number
  problems: number
  critical: number
  warning: number
  down: number
}
/** Eigenzustand von Icinga: kurze Laufzeit verrät einen unbemerkten Neustart. */
export interface IcingaHealth {
  version: string
  nodeName: string
  checksPerMinute: number
  latency: number
  executionTime: number
  uptimeSeconds: number
}
export interface IcingaSummary {
  hosts: { up: number; down: number; unreachable: number; acknowledged: number; inDowntime: number }
  services: { ok: number; warning: number; critical: number; unknown: number; acknowledged: number; inDowntime: number }
  /** Offene Meldungen (max. 30, ausgefallene Hosts zuerst; ohne Bestätigte und Wartung). */
  problems: IcingaProblem[]
  /** Alle Gruppen (max. 12), betroffene zuerst — auch die gesunden. */
  groups: IcingaGroup[]
  icinga: IcingaHealth | null
  /** Überfällige Prüfungen — Icinga prüft diese Objekte nicht mehr (stiller Ausfall). */
  staleChecks: number
  /** Meldungen, die noch beobachtet werden (zu frisch/weich/flatternd) — bewusst nicht auf der Tafel. */
  settling: number
  /** Bestätigte Meldungen (max. 10, älteste zuerst): jemand kümmert sich schon darum. */
  acknowledged: IcingaAcknowledged[]
  /** Zuletzt von selbst erholt (max. 8, letzte Stunde, neueste zuerst). */
  recovered: IcingaRecovered[]
  /** Hosts mit den meisten offenen Meldungen (max. 6). */
  topHosts: { host: string; count: number }[]
  /** Die am längsten offene Meldung — „seit wann brennt es schon". */
  oldestProblem: IcingaProblem | null
  /** Verlauf der letzten Stunden (alle 30 s ein Punkt, max. 4 h) — besser oder schlechter? */
  history: IcingaHistoryPoint[]
  totals: { hosts: number; services: number }
  /** Serverzeit des Abrufs — Grundlage für „Stand" und das Alter der Meldungen. */
  fetchedAt: number
}

export interface Display {
  id: string; name: string; description?: string | null; authorized: boolean
  status: 'online' | 'offline' | 'pending'; lastSeenAt?: string | null
  resolutionW?: number | null; resolutionH?: number | null; clientVersion?: string | null
  defaultLayoutId?: string | null; pairingCode?: string | null
}
