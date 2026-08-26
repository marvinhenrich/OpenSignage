/**
 * Icinga-Anbindung: Der CMS-Server holt den Monitoring-Status per Icinga-2-API und
 * liefert eine kompakte Zusammenfassung fuer die Statuskachel.
 *
 * Warum serverseitig (und nicht ein iframe auf dem Display):
 *  - Zugangsdaten liegen an EINER Stelle (Server-.env), nicht auf jedem Fernseher.
 *  - Die Displays brauchen keinen Zugang ins Monitoring-Netz und kein Zertifikat.
 *  - Kein Login-Formular, keine Session-Timeouts, keine X-Frame-Options-Probleme.
 *
 * ZUGRIFF (bewusst eng):
 *  - `/api/icinga`        nur fuer Administratoren.
 *  - `/api/player/icinga` fuer freigegebene Displays (der Fernseher hat keine Sitzung).
 *
 * Konfiguration ueber die Umgebung (ICINGA_URL, ICINGA_API_USER, ICINGA_API_PASSWORD,
 * ICINGA_TLS_REJECT_UNAUTHORIZED). Port 5665 ist die API; Icinga Web 2 auf 443 ist
 * etwas anderes und funktioniert hier nicht.
 */
import { Hono } from 'hono'
import https from 'node:https'
import { Err, AppError } from '../lib/errors.js'
import { requireRole, type AppEnv } from '../auth/middleware.js'
import { db } from '../db/index.js'
import { icingaHistory } from '../db/schema.js'
import { gte, asc, lt } from 'drizzle-orm'

export const icingaRoutes = new Hono<AppEnv>()

export interface IcingaSummary {
  hosts: { up: number; down: number; unreachable: number; acknowledged: number; inDowntime: number }
  services: { ok: number; warning: number; critical: number; unknown: number; acknowledged: number; inDowntime: number }
  /**
   * Offene Probleme (ohne Bestaetigte und ohne Wartung) - Hosts UND Dienste.
   * Sortiert: ausgefallene Hosts zuerst, dann kritisch, dann unbekannt, dann Warnung;
   * innerhalb dessen das aelteste Problem oben.
   */
  problems: Array<{ kind: 'host' | 'service'; host: string; service: string; label: string; state: string; since: number; output: string }>
  /** Wo brennt es? Problemzahlen je Host-/Servicegruppe, absteigend nach Schwere. */
  groups: Array<{ name: string; critical: number; warning: number; down: number; ok: number; total: number }>
  /** Eigenzustand von Icinga (Version, Pruefrate, Latenz) - null, wenn nicht abfragbar. */
  icinga: { version: string; nodeName: string; checksPerMinute: number; latency: number; executionTime: number; uptimeSeconds: number } | null
  /** Pruefungen, die ueberfaellig sind (Icinga selbst prueft nicht mehr) - stiller Ausfall! */
  staleChecks: number
  /** Noch nicht bestaetigte Meldungen (zu frisch/weich/flatternd) - bewusst nicht auf der Tafel. */
  settling: number
  /** Bestaetigte Meldungen: jemand kuemmert sich schon darum (aelteste zuerst). */
  acknowledged: Array<{ kind: 'host' | 'service'; host: string; service: string; label: string; state: string; since: number }>
  /** Zuletzt von selbst erholt (letzte Stunde, neueste zuerst) - zeigt Bewegung im Ruhezustand. */
  recovered: Array<{ kind: 'host' | 'service'; host: string; service: string; label: string; at: number; output: string }>
  /** Hosts mit den meisten offenen Meldungen. */
  topHosts: Array<{ host: string; count: number }>
  /** Die am laengsten offene Meldung - "seit wann brennt es schon". */
  oldestProblem: { kind: 'host' | 'service'; host: string; service: string; label: string; state: string; since: number; output: string } | null
  /** Verlauf der letzten Stunden (alle 30 s ein Punkt) - zeigt, ob es besser oder schlechter wird. */
  history: Array<{ t: number; problems: number; critical: number; warning: number; down: number }>
  totals: { hosts: number; services: number }
  /** Serverzeit des Abrufs - daraus zeigt die Kachel "Stand vor X". */
  fetchedAt: number
}

const TTL = 30_000
/**
 * Beruhigungszeit, bevor eine Stoerung auf die Tafel darf.
 *
 * Grund: Steht ein Host auf `max_check_attempts = 1`, gilt ein EINZIGER verlorener Ping
 * sofort als bestaetigte Stoerung, obwohl das Geraet erreichbar ist. Solche Zuckungen sind
 * nach einer Minute wieder weg und machen ein Wallboard unbrauchbar.
 *
 * Zusaetzlich werden WEICHE Zustaende (state_type 0) und flatternde Objekte ausgeblendet -
 * beides sind Faelle, in denen Icinga selbst noch nicht sicher ist.
 *
 * Der saubere Fix waere `max_check_attempts` in Icinga auf 3-5 zu setzen; dann faengt Icinga
 * das selbst ab und verschickt auch keine falschen Benachrichtigungen mehr.
 */
const SETTLE_MS = 90_000

/** Ab wann gilt eine Pruefung als ueberfaellig (Icinga prueft das Objekt nicht mehr)? */
const STALE_CHECK_MS = 15 * 60_000
let cache: { t: number; data: IcingaSummary } | null = null

/**
 * Verlauf im Arbeitsspeicher: alle 30 s ein Punkt, 4 Stunden = 480 Punkte (~20 KB).
 * Bewusst NICHT in der Datenbank - das ist Anzeige-Beiwerk, kein Betriebsdatum.
 * Nach einem CMS-Neustart faengt der Verlauf leer an und fuellt sich von selbst.
 */
const HISTORY_WINDOW_MS = 24 * 3600_000
let lastHistoryWrite = 0

/**
 * Einen Verlaufspunkt sichern. Bewusst in der Datenbank: im Arbeitsspeicher waere der Verlauf
 * nach jedem CMS-Neustart leer und die Kachel zeigte dauernd "wird aufgebaut" - dann ist ein
 * Verlauf wertlos. Aeltere Punkte als 24 h werden beim Schreiben mit aufgeraeumt.
 */
async function pushHistory(sum: IcingaSummary): Promise<void> {
  if (Date.now() - lastHistoryWrite < 25_000) return
  lastHistoryWrite = Date.now()
  try {
    await db.insert(icingaHistory).values({
      problems: sum.problems.length,
      critical: sum.services.critical,
      warning: sum.services.warning,
      down: sum.hosts.down + sum.hosts.unreachable,
    })
    await db.delete(icingaHistory).where(lt(icingaHistory.at, new Date(Date.now() - HISTORY_WINDOW_MS)))
  } catch { /* Verlauf ist Beiwerk - darf den Statusabruf nie stoeren */ }
}

/** Verlauf der letzten 24 h laden (aufsteigend). */
async function loadHistory(): Promise<IcingaSummary['history']> {
  try {
    const rows = await db.select().from(icingaHistory)
      .where(gte(icingaHistory.at, new Date(Date.now() - HISTORY_WINDOW_MS)))
      .orderBy(asc(icingaHistory.at))
    return rows.map((r) => ({
      t: new Date(r.at).getTime(), problems: r.problems, critical: r.critical, warning: r.warning, down: r.down,
    }))
  } catch { return [] }
}

/** Zeitfenster, in dem eine Erholung als "gerade eben" gilt. */
const RECOVERED_WINDOW_MS = 60 * 60_000

const SERVICE_STATE = ['ok', 'warning', 'critical', 'unknown'] as const
const HOST_STATE = ['up', 'down', 'unreachable'] as const

/**
 * Lesbare Bezeichnung fuer einen Pruefnamen.
 *
 * Icinga selbst liefert KEINE Uebersetzung: `display_name` ist bei allen 653 Diensten mit dem
 * technischen Namen identisch, `notes` sind leer. Auf einem Wallboard, das aus mehreren Metern
 * gelesen wird, ist "WINDOWS_AGENT_MEMORY_ALL_SA" aber wertlos.
 * Die Benennung ist systematisch, deshalb genuegen wenige Regeln. Passt keine, bleibt der
 * Originalname stehen - lieber technisch als falsch.
 * (Sauberer waere es, in Icinga `display_name` zu pflegen; dann wirkt es auch in Icinga Web.)
 * ACHTUNG: KEIN \\b vor einem Unterstrich - '_' ist ein Wortzeichen, es gibt dort keine Wortgrenze.
 */
const NAME_RULES: Array<[RegExp, string]> = [
  [/^WINDOWS_AGENT_MEMORY/i, 'Arbeitsspeicher'],
  [/^WINDOWS_AGENT_CPU/i, 'CPU-Auslastung'],
  [/^WINDOWS_AGENT_DISKS?/i, 'Datenträger'],
  [/^WINDOWS_AGENT_NETWORK/i, 'Netzwerk'],
  [/^WINDOWS_AGENT_WINDOWSUPDATES/i, 'Windows-Updates'],
  [/^WINDOWS_AGENT_UPTIME/i, 'Laufzeit'],
  [/^WINDOWS_AGENT_/i, 'Windows-Agent'],
  [/^Windows_Check_WithSecure/i, 'Virenschutz (WithSecure)'],
  [/^WINDOWS_SERVICES_CHECK_(.+)$/i, 'Dienst $1'],
  [/^CHECK_(.+)$/i, 'Dienst $1'],
  [/^PING\b/i, 'Erreichbarkeit'],
  [/^HTTPS?\b/i, 'Webdienst'],
  [/^DISK/i, 'Datenträger'],
  [/^LOAD/i, 'Systemlast'],
]

/**
 * Pruefausgabe lesbar machen. Icinga liefert z.B. "LOAD WARNING 82.3341%".
 * Auf einem Wallboard stoert daran zweierlei: der Zustand steht bereits als Kurzwort
 * daneben (redundant), und vier Nachkommastellen liest aus 5 m niemand.
 * -> Zustandswort entfernen, Zahlen auf eine Nachkommastelle, Komma statt Punkt.
 */
export function prettyOutput(raw: string): string {
  let t = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  // fuehrendes "<METRIK> <ZUSTAND>" entfernen, z.B. "LOAD WARNING 82.3%" -> "82.3%"
  t = t.replace(/^([A-Za-z_]+ )?(OK|WARNING|CRITICAL|UNKNOWN)\b[:\s-]*/i, '')
  // lange Dezimalzahlen kuerzen und deutsches Komma setzen
  t = t.replace(/(\d+)\.(\d+)/g, (_m, a: string, b: string) => `${a},${b.slice(0, 1)}`)
  // Prozentzeichen abtrennen, liest sich ruhiger
  t = t.replace(/(\d)%/g, '$1 %')
  return t.slice(0, 120).trim()
}

export function prettyCheckName(raw: string): string {
  const n = (raw ?? '').trim()
  if (!n) return ''
  for (const [re, label] of NAME_RULES) {
    const m = n.match(re)
    if (m) return label.includes('$1') ? label.replace('$1', (m[1] ?? '').replace(/[_$]+/g, ' ').trim()) : label
  }
  return n
}

function cfg() {
  return {
    url: (process.env.ICINGA_URL ?? '').replace(/\/+$/, ''),
    user: process.env.ICINGA_API_USER ?? '',
    pass: process.env.ICINGA_API_PASSWORD ?? '',
    strict: process.env.ICINGA_TLS_REJECT_UNAUTHORIZED === 'true',
  }
}

/**
 * Eine Abfrage an die Icinga-2-API. Bewusst mit node:https statt fetch, weil Icinga
 * eine eigene CA verwendet und wir dafuer `rejectUnauthorized` setzen muessen -
 * das kann Nodes globales fetch nicht (und eine neue Abhaengigkeit wollen wir nicht).
 */
function query(path: string, body: unknown): Promise<any> {
  const { url, user, pass, strict } = cfg()
  const u = new URL(url + path)
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      rejectUnauthorized: strict,
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // Icinga erlaubt lesende Abfragen mit Rumpf ueber diesen Header
        'X-HTTP-Method-Override': 'GET',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (d) => chunks.push(d as Buffer))
      res.on('end', () => {
        const status = res.statusCode ?? 0
        const text = Buffer.concat(chunks).toString('utf8')
        if (status === 401) {
          return reject(Err.unavailable('Icinga lehnt die Zugangsdaten ab (401). ApiUser-Name/Passwort pruefen; ein neu angelegter ApiUser wird erst nach "systemctl reload icinga2" aktiv.'))
        }
        if (status === 403 || status === 404) {
          return reject(Err.unavailable(`Icinga verweigert die Abfrage (HTTP ${status}). Dem ApiUser fehlen vermutlich die Berechtigungen "status/query", "objects/query/Host", "objects/query/Service".`))
        }
        if (status < 200 || status >= 300) return reject(Err.unavailable(`Icinga antwortet mit HTTP ${status}.`))
        try { resolve(JSON.parse(text)) } catch { reject(Err.unavailable('Icinga lieferte eine unlesbare Antwort.')) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(Err.unavailable('Icinga antwortet nicht (Zeitueberschreitung nach 8 s).')) })
    req.on('error', (e: any) => {
      const hint = e?.code === 'ECONNREFUSED' ? ' Ist die API (Port 5665) freigegeben?'
        : e?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ? ' Zertifikat nicht vertrauenswuerdig - ICINGA_TLS_REJECT_UNAUTHORIZED=false setzen.'
        : ''
      reject(Err.unavailable(`Icinga nicht erreichbar (${e?.code ?? 'Fehler'}).${hint}`))
    })
    req.write(payload)
    req.end()
  })
}

async function load(): Promise<IcingaSummary> {
  const { url, user, pass } = cfg()
  if (!url || !user || !pass) {
    throw Err.unavailable('Icinga ist nicht konfiguriert (ICINGA_URL, ICINGA_API_USER, ICINGA_API_PASSWORD fehlen in der Server-Konfiguration).')
  }

  const [hostRes, svcRes, cibRes, appRes] = await Promise.all([
    query('/v1/objects/hosts', {
      attrs: ['state', 'state_type', 'flapping', 'acknowledgement', 'downtime_depth', 'last_state_change', 'display_name', 'groups', 'last_check', 'last_check_result'],
    }),
    query('/v1/objects/services', {
      attrs: ['state', 'state_type', 'flapping', 'last_state_change', 'display_name', 'acknowledgement', 'downtime_depth', 'host_name', 'groups', 'last_check', 'last_check_result'],
    }),
    // Icinga-Eigenzustand (Pruefrate, Latenz, Laufzeit) - fuer den Baustein "Icinga-Zustand".
    query('/v1/status/CIB', {}).catch(() => null),
    // Version/Knotenname stehen NICHT in CIB, sondern hier.
    query('/v1/status/IcingaApplication', {}).catch(() => null),
  ])

  const now = Date.now()
  const hosts = { up: 0, down: 0, unreachable: 0, acknowledged: 0, inDowntime: 0 }
  const services = { ok: 0, warning: 0, critical: 0, unknown: 0, acknowledged: 0, inDowntime: 0 }
  const problems: IcingaSummary['problems'] = []
  /** Problemzaehler je Gruppe - zeigt, WO es brennt (z.B. "Server", "Netzwerk"). */
  const byGroup = new Map<string, { name: string; critical: number; warning: number; down: number; ok: number; total: number }>()
  let staleChecks = 0
  /** Meldungen, die noch beobachtet werden (zu frisch, weich oder flatternd). */
  let settling = 0

  const grp = (names: unknown): string[] => (Array.isArray(names) ? names.filter((x): x is string => typeof x === 'string') : [])
  const bump = (names: string[], kind: 'critical' | 'warning' | 'down' | null, healthy: boolean) => {
    for (const n of names) {
      const g = byGroup.get(n) ?? { name: n, critical: 0, warning: 0, down: 0, ok: 0, total: 0 }
      g.total++
      if (kind) g[kind]++
      if (healthy) g.ok++
      byGroup.set(n, g)
    }
  }
  /** Bestaetigte Meldungen: jemand kuemmert sich bereits - gehoert auf ein Wallboard. */
  const acknowledged: IcingaSummary['acknowledged'] = []
  /** Zuletzt erholt: zeigt Bewegung, auch wenn gerade nichts brennt. */
  const recovered: IcingaSummary['recovered'] = []
  /** Welcher Host haeuft die meisten Probleme an? */
  const perHost = new Map<string, number>()

  // --- Hosts: Zaehlung UND (neu) ausgefallene Hosts in die Problemliste ---
  for (const h of hostRes?.results ?? []) {
    const a = h?.attrs ?? {}
    const state = HOST_STATE[a.state ?? 0] ?? 'up'
    hosts[state]++
    const handled = !!a.acknowledgement || !!a.downtime_depth
    if (state !== 'up' && a.acknowledgement) hosts.acknowledged++
    if (state !== 'up' && a.downtime_depth) hosts.inDowntime++
    if (a.last_check && now - Number(a.last_check) * 1000 > STALE_CHECK_MS) staleChecks++
    bump(grp(a.groups), state !== 'up' && !handled ? 'down' : null, state === 'up')
    if (state !== 'up' && a.acknowledgement) acknowledged.push({ kind: 'host', host: String(a.display_name ?? h?.name ?? '?'), service: '', label: '', state, since: Number(a.last_state_change ?? 0) * 1000 })
    if (state === 'up' && a.last_state_change && now - Number(a.last_state_change) * 1000 < RECOVERED_WINDOW_MS) {
      recovered.push({ kind: 'host', host: String(a.display_name ?? h?.name ?? '?'), service: '', label: '', at: Number(a.last_state_change) * 1000, output: prettyOutput(String(a.last_check_result?.output ?? '')) })
    }
    // Ein ausgefallener Host ist das Wichtigste auf einem IT-Wallboard - er MUSS in die Liste.
    // Aber erst, wenn die Stoerung Bestand hat (siehe SETTLE_MS).
    const hSoft = Number(a.state_type ?? 1) === 0 || !!a.flapping
    const hFresh = now - Number(a.last_state_change ?? 0) * 1000 < SETTLE_MS
    if (state !== 'up' && !handled && (hSoft || hFresh)) settling++
    if (state !== 'up' && !handled && !hSoft && !hFresh) {
      problems.push({
        kind: 'host',
        host: String(a.display_name ?? h?.name ?? '?'),
        service: '',
        label: '',
        state,
        since: Number(a.last_state_change ?? 0) * 1000,
        output: prettyOutput(String(a.last_check_result?.output ?? '')),
      })
    }
  }

  // --- Dienste ---
  for (const s of svcRes?.results ?? []) {
    const a = s?.attrs ?? {}
    const state = SERVICE_STATE[a.state ?? 0] ?? 'ok'
    services[state]++
    const handled = !!a.acknowledgement || !!a.downtime_depth
    if (state !== 'ok' && a.acknowledgement) services.acknowledged++
    if (state !== 'ok' && a.downtime_depth) services.inDowntime++
    if (a.last_check && now - Number(a.last_check) * 1000 > STALE_CHECK_MS) staleChecks++
    bump(grp(a.groups), state === 'critical' && !handled ? 'critical' : state === 'warning' && !handled ? 'warning' : null, state === 'ok')
    const hn = String(a.host_name ?? '?')
    if (state !== 'ok' && !handled) perHost.set(hn, (perHost.get(hn) ?? 0) + 1)
    if (state !== 'ok' && a.acknowledgement) acknowledged.push({ kind: 'service', host: hn, service: String(a.display_name ?? ''), label: prettyCheckName(String(a.display_name ?? '')), state, since: Number(a.last_state_change ?? 0) * 1000 })
    if (state === 'ok' && a.last_state_change && now - Number(a.last_state_change) * 1000 < RECOVERED_WINDOW_MS) {
      recovered.push({ kind: 'service', host: hn, service: String(a.display_name ?? ''), label: prettyCheckName(String(a.display_name ?? '')), at: Number(a.last_state_change) * 1000, output: prettyOutput(String(a.last_check_result?.output ?? '')) })
    }
    // Bestaetigtes und Wartung bleiben aus der Liste - sie stoeren den Blick auf das Offene.
    const sSoft = Number(a.state_type ?? 1) === 0 || !!a.flapping
    const sFresh = now - Number(a.last_state_change ?? 0) * 1000 < SETTLE_MS
    if (state !== 'ok' && !handled && (sSoft || sFresh)) settling++
    if (state !== 'ok' && !handled && !sSoft && !sFresh) {
      problems.push({
        kind: 'service',
        host: String(a.host_name ?? '?'),
        service: String(a.display_name ?? ''),
        label: prettyCheckName(String(a.display_name ?? '')),
        state,
        since: Number(a.last_state_change ?? 0) * 1000,
        output: prettyOutput(String(a.last_check_result?.output ?? '')),
      })
    }
  }

  // Reihenfolge: ausgefallene Hosts zuerst, dann kritisch, dann Warnung; innerhalb dessen das aelteste
  // Problem oben (was am laengsten offen ist, ist meist das wichtigste).
  const rank = (p: IcingaSummary['problems'][number]) =>
    p.kind === 'host' ? 0 : p.state === 'critical' ? 1 : p.state === 'unknown' ? 2 : 3
  problems.sort((a, b) => (rank(a) !== rank(b) ? rank(a) - rank(b) : a.since - b.since))

  // ALLE Gruppen zurueckgeben, nicht nur die mit Problemen: sonst ist die Gruppenansicht
  // im Normalbetrieb leer - und genau dann soll das Wallboard zeigen, dass die Anlage steht
  // ("WLAN 100/100", "WINDOWS SERVERS 89/89"). Betroffene Gruppen stehen oben.
  const groups = [...byGroup.values()]
    .sort((a, b) => {
      const sev = (g: typeof a) => g.down * 100 + g.critical * 10 + g.warning
      return sev(b) - sev(a) || b.total - a.total
    })
    .slice(0, 12)

  const cib = cibRes?.results?.[0]?.status ?? null
  const app = appRes?.results?.[0]?.status?.icingaapplication?.app ?? null
  const icinga = cib ? {
    version: String(app?.version ?? ''),
    nodeName: String(app?.node_name ?? ''),
    checksPerMinute: Math.round((cib.active_host_checks_1min ?? 0) + (cib.active_service_checks_1min ?? 0)),
    latency: Number(cib.avg_latency ?? 0),
    executionTime: Number(cib.avg_execution_time ?? 0),
    // Laufzeit von Icinga selbst - ein kurzer Wert verraet einen unbemerkten Neustart.
    uptimeSeconds: Number(cib.uptime ?? 0),
  } : null

  acknowledged.sort((a, b) => a.since - b.since)
  recovered.sort((a, b) => b.at - a.at)
  const topHosts = [...perHost.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count).slice(0, 6)

  const summary: IcingaSummary = {
    hosts, services, problems: problems.slice(0, 30), groups, icinga,
    staleChecks,
    settling,
    acknowledged: acknowledged.slice(0, 10),
    recovered: recovered.slice(0, 8),
    topHosts,
    // Laengste offene Meldung - "seit wann brennt es schon" ist die wichtigste Einzelangabe.
    oldestProblem: problems.length ? problems.reduce((a, b) => (a.since && a.since < b.since ? a : b)) : null,
    history: [],
    totals: { hosts: hostRes?.results?.length ?? 0, services: svcRes?.results?.length ?? 0 },
    fetchedAt: Date.now(),
  }
  await pushHistory(summary)
  summary.history = await loadHistory()
  return summary
}

/** Gemeinsamer, gecachter Zugriff - egal ob Admin-Vorschau oder Player. */
export async function icingaSummary(): Promise<IcingaSummary> {
  if (cache && Date.now() - cache.t < TTL) return cache.data
  try {
    const data = await load()
    cache = { t: Date.now(), data }
    return data
  } catch (err) {
    if (err instanceof AppError) throw err
    throw Err.unavailable(`Icinga nicht erreichbar: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`)
  }
}

// Monitoring-Daten sind IT-Sache: nur Admins. Grafiker (Rang wie operator) bekommen 403.
icingaRoutes.get('/', requireRole('admin'), async (c) => c.json(await icingaSummary()))
