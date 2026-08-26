import { useEffect, useMemo, useRef, useState } from 'react'
import type { LayoutTree, PlayerPlayError, PlayerState, Widget } from '../lib/api'
import { RegionPlayer, EmergencyView, RenderEnvProvider, type PlayErrorCode } from '../components/render'
import { useBrand } from '../lib/brand'

// ---------------------------------------------------------------------------
// Player: läuft im Vollbild (Kiosk). Identifiziert sich per hardwareKey,
// zeigt bis zur Freigabe einen Pairing-Code, rendert danach den Layout-Baum
// live und lädt bei WS-Push (reload) neu. Klare Status-/Fehleranzeige.
// ---------------------------------------------------------------------------

// Von der Electron-Kiosk-App bereitgestellte Brücke für OS-Befehle (im Browser nicht vorhanden).
declare global {
  interface Window {
    stvClient?: {
      reboot(): void
      shutdown(): void
      restart(): void
      captureScreenshot(): Promise<string>
      version?: string
    }
  }
}

/**
 * Fernsteuerbefehl ausfuehren und ehrlich zurueckmelden, ob es geklappt hat.
 * Wichtig: Im Edge-Kiosk (Assigned Access) gibt es KEINE OS-Bruecke (window.stvClient).
 * Frueher wurden Neustart/Herunterfahren/Screenshot dort stillschweigend verworfen -
 * im CMS sah es aus, als haette der Befehl "keine Wirkung". Jetzt gibt es eine klare
 * Meldung, die im Display-Protokoll landet.
 */
async function handleCommand(code: string, hwKey: string, devKey: string): Promise<{ ok: boolean; error?: string }> {
  if (code === 'RELOAD' || code === 'RESTART') {
    // Neu laden kann der Browser selbst - reicht fuer "Player neu starten".
    setTimeout(() => location.reload(), 200)
    return { ok: true }
  }
  const cl = window.stvClient
  if (!cl) {
    return { ok: false, error: 'Dieses Geraet laeuft als Edge-Kiosk ohne OS-Bruecke. Neustart/Herunterfahren/Screenshot sind hier nicht moeglich - dafuer wird der Geraeteagent benoetigt.' }
  }
  try {
    if (code === 'REBOOT') { cl.reboot(); return { ok: true } }
    if (code === 'SHUTDOWN') { cl.shutdown(); return { ok: true } }
    if (code === 'SCREENSHOT') {
      const dataUrl = await cl.captureScreenshot()
      const blob = await (await fetch(dataUrl)).blob()
      const form = new FormData(); form.append('file', blob, 'screenshot.jpg')
      const res = await fetch(`/api/player/screenshot?key=${encodeURIComponent(hwKey)}${devKey ? `&k=${encodeURIComponent(devKey)}` : ''}`, { method: 'POST', body: form })
      if (!res.ok) return { ok: false, error: `Screenshot-Upload fehlgeschlagen (HTTP ${res.status})` }
      return { ok: true }
    }
    return { ok: false, error: `Unbekannter Befehl: ${code}` }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

/**
 * Geraete-Geheimnis aus der Kiosk-URL (?k=...). Der Rechnername allein ist KEIN Nachweis
 * (im AD aufzaehlbar) - der Kiosk-Installer erzeugt je Geraet ein Geheimnis und haengt es an.
 * Altgeraete ohne Geheimnis laufen unveraendert weiter (der Server laesst sie zu).
 * Bewusst NICHT in localStorage: Assigned Access wischt das Edge-Profil bei jedem Neustart.
 */
/** Paketfassung des Kiosk-Installers (?v=). Im Edge-Kiosk gibt es keine OS-Bruecke, die sie melden koennte. */
function getClientVersion(): string {
  const v = new URLSearchParams(location.search).get('v') ?? ''
  return v.trim().slice(0, 40)
}

function getDeviceKey(): string {
  const v = new URLSearchParams(location.search).get('k') ?? ''
  return v.trim().slice(0, 200)
}

function getHardwareKey(): string {
  const K = 'signage_hwkey'
  // Stabile ID hat Vorrang: der Kiosk uebergibt ?id=<Rechnername>. So bleibt die Identitaet
  // ueber Reboots/Profil-Resets erhalten (Assigned Access wischt sonst localStorage -> neuer Key).
  const urlId = new URLSearchParams(location.search).get('id')
  if (urlId) {
    const clean = urlId.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60)
    if (clean) { try { localStorage.setItem(K, clean) } catch { /* ignore */ } return clean }
  }
  let v = localStorage.getItem(K)
  if (!v) {
    v = 'web-' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36))
    localStorage.setItem(K, v)
  }
  return v
}

interface Content {
  authorized: boolean
  name?: string
  pairingCode?: string | null
  display?: { id: string; name: string; width: number | null; height: number | null }
  mode?: 'layout' | 'campaign' | 'emergency' | 'none'
  layout?: LayoutTree | null
  campaignLayouts?: LayoutTree[]
  emergency?: { text: string; subtext?: string | null; color?: string; background?: string }
  version?: string
  source?: string
}

type Conn = 'verbindet' | 'online' | 'offline'

export default function Player() {
  const hwKey = useMemo(getHardwareKey, [])
  const devKey = useMemo(getDeviceKey, [])
  const cliVer = useMemo(getClientVersion, [])
  const [content, setContent] = useState<Content | null>(null)
  const [conn, setConn] = useState<Conn>('verbindet')
  const [error, setError] = useState<string>('')
  const wsRef = useRef<WebSocket | null>(null)

  // Signage: Maus-Cursor im Player komplett ausblenden (nur solange der Player läuft).
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = 'html, body, * , *::before, *::after { cursor: none !important; }'
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

  // Proof-of-Play: Play-Ereignisse sammeln und gebatcht ans CMS melden.
  const popBuf = useRef<any[]>([])
  useEffect(() => {
    const flush = () => {
      if (!popBuf.current.length) return
      const events = popBuf.current.splice(0)
      fetch('/api/player/pop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: hwKey, deviceKey: devKey || undefined, events }) }).catch(() => {})
    }
    const t = setInterval(flush, 25000)
    return () => { flush(); clearInterval(t) }
  }, [hwKey])

  // -------------------------------------------------------------------------
  // Wiedergabe-Zustand fuer die Wall.
  // Bewusst in Refs statt State: das Melden loest KEINEN Re-Render im Player aus.
  // Gesendet wird nur bei Aenderung (Signaturvergleich) + alle 10 s als Herzschlag.
  // -------------------------------------------------------------------------
  const stateRef = useRef<PlayerState>({
    mode: 'none', conn: 'offline', contentVersion: null, source: null, pairingCode: null,
    screen: { w: 0, h: 0 }, layout: null, campaign: null, emergency: null,
    regions: [], errors: [], playerError: null,
  })
  /**
   * regionId -> aktuell laufendes Widget (wird aus onPlay des geteilten Renderers gefuellt).
   * Jeder Eintrag traegt Layout und Inhaltsfassung, aus der er stammt. Veraltete Eintraege
   * werden beim Senden verworfen (siehe pushState) - NICHT beim Inhaltswechsel geleert:
   * React fuehrt Kind-Effekte VOR Eltern-Effekten aus, ein Leeren im Eltern-Effekt wuerde
   * also genau die Meldung wieder ausloeschen, die das Kind gerade abgegeben hat.
   */
  const regionsRef = useRef(new Map<string, {
    id: string; widgetId: string; widgetType: string; startedAt: number
    layoutId: string; version: string | null
  }>())
  const errBuf = useRef<PlayerPlayError[]>([])
  const errSeen = useRef(new Map<string, number>())

  const report: Report = (layoutId, regionId, w) => {
    const version = content?.version ?? null
    const prev = regionsRef.current.get(regionId)
    if (prev && prev.widgetId === w.id && prev.layoutId === layoutId) {
      // Dasselbe Widget laeuft weiter (z. B. nach dem Neuladen derselben Inhalte):
      // nur neu stempeln - kein zweiter Proof-of-Play-Eintrag, Startzeit bleibt erhalten.
      prev.version = version
      return
    }
    popBuf.current.push({ layoutId, widgetId: w.id, mediaId: w.mediaId ?? null, startedAt: new Date().toISOString(), durationSeconds: w.durationSeconds })
    regionsRef.current.set(regionId, { id: regionId, widgetId: w.id, widgetType: w.type, startedAt: Date.now(), layoutId, version })
  }

  /** Wiedergabefehler in den Ringpuffer (max. 5), dedupliziert je Widget+Code fuer 60 s. */
  const noteError: OnPlayError = (regionId, w, code, message) => {
    const sig = `${w.id}|${code}`
    const now = Date.now()
    const last = errSeen.current.get(sig)
    if (last && now - last < 60_000) return
    errSeen.current.set(sig, now)
    for (const [k, t] of errSeen.current) if (now - t > 60_000) errSeen.current.delete(k)
    errBuf.current.push({ regionId, widgetId: w.id, code, message: String(message).slice(0, 200), at: now })
    while (errBuf.current.length > 5) errBuf.current.shift()
  }

  /** Layout, das gerade wirklich auf dem Schirm steht (auch innerhalb einer Kampagne). */
  const onStage: OnStage = (l, campaign) => {
    const s = stateRef.current
    // Kein Leeren der Regionskarte: Eintraege aus anderen Layouts passen dann nicht mehr
    // zum Buehnen-Layout und werden beim Senden ohnehin aussortiert.
    s.layout = { id: l.id, name: l.name, width: l.width, height: l.height }
    s.campaign = campaign ?? null
  }

  const errorRef = useRef('')

  // Inhalt -> Zustand spiegeln (ein Effekt, keine Berechnung im Renderpfad)
  useEffect(() => {
    const s = stateRef.current
    const nextVersion = content?.version ?? null
    // Kein Leeren hier: die Regionsmeldungen der neuen Fassung sind zu diesem Zeitpunkt
    // bereits eingegangen (Kind-Effekte laufen vor Eltern-Effekten). Eintraege alter
    // Fassungen tragen eine andere Version und fallen in pushState heraus.
    s.contentVersion = nextVersion
    s.source = (content?.source as PlayerState['source']) ?? null
    s.pairingCode = content && !content.authorized ? (content.pairingCode ?? null) : null
    s.emergency = content?.mode === 'emergency' && content.emergency ? content.emergency : null
    if (!content) s.mode = 'none'
    else if (!content.authorized) s.mode = 'pairing'
    else if (content.mode === 'emergency' && content.emergency) s.mode = 'emergency'
    else if (content.mode === 'campaign' && content.campaignLayouts?.length) s.mode = 'campaign'
    else if (content.layout) s.mode = 'layout'
    else s.mode = 'none'
    if (s.mode !== 'layout' && s.mode !== 'campaign') { s.layout = null; s.campaign = null; regionsRef.current.clear() }
    if (errorRef.current && !content) s.mode = 'error'
  }, [content])

  useEffect(() => { stateRef.current.conn = conn === 'online' ? 'online' : 'offline' }, [conn])
  useEffect(() => {
    errorRef.current = error
    stateRef.current.playerError = error || null
    // 'error' nur, solange gar kein Inhalt steht - laeuft der letzte Inhalt weiter,
    // ist der Modus weiterhin 'layout' und der Fehler wird separat als playerError gemeldet.
    if (error && !content) stateRef.current.mode = 'error'
  }, [error, content])

  const lastSigRef = useRef('')
  const lastSentRef = useRef(0)
  const pushState = (force = false) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const s = stateRef.current
    // Fehler aelter als 10 min verfallen: sonst klebt ein einmal rotes Abzeichen ewig an der Kachel.
    const cutoff = Date.now() - 10 * 60_000
    while (errBuf.current.length && errBuf.current[0].at < cutoff) errBuf.current.shift()
    // Nur Regionen melden, die zum aktuell gespielten Layout UND zur aktuellen Inhaltsfassung
    // gehoeren. Alles andere stammt aus einer abgeloesten Fassung/einem anderen Layout und
    // wird verworfen - das haelt die Karte klein und die Meldung ehrlich.
    for (const [k, v] of regionsRef.current) {
      if (v.layoutId !== s.layout?.id || v.version !== s.contentVersion) regionsRef.current.delete(k)
    }
    s.regions = [...regionsRef.current.values()].map((r) => ({
      id: r.id, widgetId: r.widgetId, widgetType: r.widgetType, startedAt: r.startedAt,
    }))
    s.errors = [...errBuf.current]
    s.screen = { w: Math.round(window.innerWidth), h: Math.round(window.innerHeight) }
    const sig = [
      s.mode, s.conn, s.contentVersion ?? '', s.layout?.id ?? '', s.campaign?.index ?? '',
      s.regions.map((r) => `${r.id}:${r.widgetId}`).join(','),
      `${s.errors.length}:${s.errors[s.errors.length - 1]?.at ?? 0}`,
      s.playerError ?? '',
    ].join('|')
    if (!force && sig === lastSigRef.current && Date.now() - lastSentRef.current < 10_000) return
    lastSigRef.current = sig
    lastSentRef.current = Date.now()
    try { ws.send(JSON.stringify({ type: 'state', v: 1, ts: Date.now(), ...s })) } catch { /* ignorieren */ }
  }
  const pushRef = useRef(pushState)
  pushRef.current = pushState

  // Genau EIN zusaetzlicher Takt im Player. Er sendet nur, wenn sich etwas geaendert hat
  // (max. 1 s Latenz) oder der 10-s-Herzschlag faellig ist -> im Ruhezustand 6 Nachrichten/min.
  useEffect(() => {
    const t = setInterval(() => pushRef.current(), 1000)
    return () => clearInterval(t)
  }, [])

  async function register() {
    try {
      const res = await fetch('/api/player/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hardwareKey: hwKey, deviceKey: devKey || undefined, width: window.screen.width, height: window.screen.height, clientVersion: window.stvClient?.version ?? (cliVer || undefined) }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(`Registrierung fehlgeschlagen: ${d?.error ?? res.status}${d?.ref ? ` (Ref. ${d.ref})` : ''}`)
      }
    } catch {
      setError('Server nicht erreichbar (Registrierung)')
    }
  }

  async function loadContent() {
    try {
      const res = await fetch(`/api/player/content?key=${encodeURIComponent(hwKey)}${devKey ? `&k=${encodeURIComponent(devKey)}` : ''}`)
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        setError(`Inhalt laden fehlgeschlagen: ${d?.error ?? res.status}${d?.ref ? ` (Ref. ${d.ref})` : ''}`)
        setConn('offline')
        return
      }
      setContent(d)
      setError('')
      setConn('online')
    } catch {
      setConn('offline')
      setError('Server nicht erreichbar (Inhalt)')
      // letzten Inhalt weiterlaufen lassen (Offline-Resilienz)
    }
  }

  // Registrierung + erster Inhalt
  useEffect(() => {
    let alive = true
    ;(async () => { await register(); if (alive) await loadContent() })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Selbstaktualisierung: Nach einem Deploy laeuft im Kiosk weiter die ALTE Programmfassung,
  // bis die Seite neu geladen wird. Auf einem Wandmonitor kann niemand F5 druecken - also
  // prueft der Player selbst, ob eine neue Fassung ausgeliefert wird, und laedt sich neu.
  // Verglichen wird der Dateiname des ausgelieferten Programms (enthaelt einen Build-Schluessel).
  useEffect(() => {
    const own = Array.from(document.querySelectorAll('script[src]'))
      .map((el) => (el as HTMLScriptElement).getAttribute('src') ?? '')
      .find((u) => /\/assets\/index-[^/]+\.js$/.test(u)) ?? ''
    if (!own) return
    let stopped = false
    async function check() {
      try {
        const res = await fetch(`/index.html?stv=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const html = await res.text()
        const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)
        if (m && m[0] !== own && !stopped) {
          // Kleiner Zufallsversatz, damit nicht alle Displays gleichzeitig neu laden.
          setTimeout(() => location.reload(), Math.random() * 20_000)
        }
      } catch { /* Netz weg: einfach beim naechsten Mal wieder versuchen */ }
    }
    const t = setInterval(check, 3 * 60_000)
    const first = setTimeout(check, 30_000)
    return () => { stopped = true; clearInterval(t); clearTimeout(first) }
  }, [])

  // WebSocket für Live-Push + Heartbeat
  useEffect(() => {
    let hb: ReturnType<typeof setInterval> | null = null
    let watchdog: ReturnType<typeof setInterval> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let closed = false
    // Zeitpunkt der letzten Nachricht VOM CMS. Der Server pingt alle 30 s (type:'ping').
    // Bleibt das aus, ist die Leitung tot ("halboffen": Proxy/Router hat sie gekappt,
    // der Browser merkt es nicht) -> aktiv neu verbinden statt scheinbar online zu haengen.
    let lastRx = Date.now()
    const DEAD_AFTER_MS = 90_000

    function cleanup() {
      if (hb) { clearInterval(hb); hb = null }
      if (watchdog) { clearInterval(watchdog); watchdog = null }
    }

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws/player?key=${encodeURIComponent(hwKey)}${devKey ? `&k=${encodeURIComponent(devKey)}` : ''}`)
      wsRef.current = ws
      ws.onopen = () => {
        setConn('online')
        lastRx = Date.now()
        // Sofort den aktuellen Zustand melden, damit die Wall nach einem CMS-Neustart
        // nicht bis zum naechsten Herzschlag leer bleibt.
        setTimeout(() => pushRef.current(true), 0)
        hb = setInterval(() => { try { ws.send(JSON.stringify({ type: 'heartbeat' })) } catch { /* ignorieren */ } }, 20000)
        watchdog = setInterval(() => {
          if (Date.now() - lastRx > DEAD_AFTER_MS) { try { ws.close() } catch { /* ignorieren */ } }
        }, 15000)
      }
      ws.onmessage = (ev) => {
        lastRx = Date.now()
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'reload' || msg.type === 'authorized') loadContent()
          else if (msg.type === 'command') {
            void handleCommand(msg.code, hwKey, devKey).then((r) => {
              try { ws.send(JSON.stringify({ type: 'command-result', code: msg.code, ok: r.ok, error: r.error })) } catch { /* ignorieren */ }
            })
          }
        } catch { /* ignorieren */ }
      }
      ws.onclose = () => {
        cleanup()
        // Signatur zuruecksetzen: nach dem Reconnect muss der volle Zustand neu gemeldet werden.
        lastSigRef.current = ''
        if (!closed) { setConn('offline'); retry = setTimeout(connect, 4000) }
      }
      ws.onerror = () => { try { ws.close() } catch { /* ignorieren */ } }
    }
    connect()
    return () => { closed = true; cleanup(); if (retry) clearTimeout(retry); wsRef.current?.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fallback-Poll, solange noch nicht freigegeben oder offline
  useEffect(() => {
    const id = setInterval(() => {
      if (!content?.authorized || conn === 'offline') loadContent()
    }, 10000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.authorized, conn])

  // --- Render ---
  const body = (() => {
    if (!content) {
      return <FullCenter><div className="text-2xl">Verbindung zum CMS…</div>{error && <ErrorLine text={error} />}</FullCenter>
    }
    if (!content.authorized) {
      return <PairingScreen code={content.pairingCode ?? undefined} name={content.name} error={error} />
    }
    if (content.mode === 'emergency' && content.emergency) {
      return (
        <div className="fixed inset-0">
          <EmergencyView emergency={content.emergency} />
          <StatusBadge conn={conn} error={error} />
        </div>
      )
    }
    if (content.mode === 'campaign' && content.campaignLayouts?.length) {
      return <CampaignStage layouts={content.campaignLayouts} conn={conn} error={error} report={report} onError={noteError} onStage={onStage} />
    }
    if (!content.layout) {
      return (
        <FullCenter>
          <div className="text-3xl font-semibold">{content.display?.name ?? 'Display'}</div>
          <div className="mt-2 text-slate-400">Kein Inhalt geplant</div>
          <StatusBadge conn={conn} error={error} />
        </FullCenter>
      )
    }
    return <Stage layout={content.layout} conn={conn} error={error} report={report} onError={noteError} onStage={onStage} />
  })()

  // Der Fernseher hat keine Sitzung: Widgets, die Serverdaten nachladen (Icinga-Kachel),
  // weisen sich mit dem Geraeteschluessel aus. In der Admin-Vorschau bleibt der Kontext
  // leer und dieselben Widgets nutzen dort den Sitzungscookie.
  return <RenderEnvProvider playerKey={hwKey} deviceKey={devKey || undefined}>{body}</RenderEnvProvider>
}

/** Kampagne: spielt die Layouts nacheinander, jedes für seine Dauer, in Schleife. */
function layoutDuration(l: LayoutTree): number {
  let max = 5
  for (const r of l.regions) {
    const sum = (r.playlist?.widgets ?? []).reduce((a, w) => a + Math.max(1, w.durationSeconds), 0)
    if (sum > max) max = sum
  }
  return max
}

type Report = (layoutId: string, regionId: string, w: Widget) => void
type OnPlayError = (regionId: string, w: Widget, code: PlayErrorCode, message: string) => void
type OnStage = (layout: LayoutTree, campaign?: { index: number; total: number }) => void

function CampaignStage({ layouts, conn, error, report, onError, onStage }: {
  layouts: LayoutTree[]; conn: Conn; error: string; report?: Report; onError?: OnPlayError; onStage?: OnStage
}) {
  const [idx, setIdx] = useState(0)
  const sig = layouts.map((l) => l.id).join(',')
  useEffect(() => { setIdx(0) }, [sig])
  useEffect(() => {
    const cur = layouts[idx % layouts.length]
    const t = setTimeout(() => setIdx((i) => (i + 1) % layouts.length), layoutDuration(cur) * 1000)
    return () => clearTimeout(t)
  }, [idx, sig, layouts])
  const cur = layouts[idx % layouts.length]
  const pos = { index: (idx % layouts.length) + 1, total: layouts.length }
  return <Stage key={cur.id} layout={cur} conn={conn} error={error} report={report} onError={onError}
    onStage={onStage ? (l) => onStage(l, pos) : undefined} />
}

// ---------------------------------------------------------------------------
function FullCenter({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-black text-white">
      {children}
    </div>
  )
}

function ErrorLine({ text }: { text: string }) {
  return <div className="mt-4 max-w-2xl px-4 text-center text-sm text-red-400">{text}</div>
}

function PairingScreen({ code, name, error }: { code?: string; name?: string; error?: string }) {
  const b = useBrand()
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-950 text-white">
      <div className="text-sm uppercase tracking-widest text-slate-400">{b.name} — Display koppeln</div>
      <div className="mt-8 text-lg text-slate-300">{name ?? 'Neues Display'}</div>
      <div className="mt-4 font-mono text-7xl font-bold tracking-[0.2em] text-white">{code ?? '––––––'}</div>
      <div className="mt-8 max-w-md text-center text-slate-400">
        Diesen Code im CMS unter <span className="font-semibold text-slate-200">Displays</span> freigeben.
        Das Display verbindet sich danach automatisch.
      </div>
      {error && <ErrorLine text={error} />}
    </div>
  )
}

function StatusBadge({ conn, error }: { conn: Conn; error?: string }) {
  // Dezent unten rechts; bei Fehler/Offline deutlich sichtbar.
  const color = conn === 'online' ? 'bg-emerald-500' : conn === 'offline' ? 'bg-red-500' : 'bg-amber-500'
  const showText = conn !== 'online' || !!error
  return (
    <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-md bg-black/60 px-2.5 py-1.5 text-xs text-white">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="capitalize">{conn}</span>
      {error && <span className="max-w-[40vw] truncate text-red-300">· {error}</span>}
    </div>
  )
}

function Stage({ layout, conn, error, report, onError, onStage }: {
  layout: LayoutTree; conn: Conn; error: string; report?: Report; onError?: OnPlayError; onStage?: OnStage
}) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / layout.width, window.innerHeight / layout.height))
    fit(); window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [layout.width, layout.height])

  // Meldet der Wall, welches Layout tatsaechlich auf dem Schirm steht (auch in Kampagnen).
  const stageRef = useRef(onStage)
  stageRef.current = onStage
  useEffect(() => { stageRef.current?.(layout) }, [layout])

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black">
      <div style={{ width: layout.width, height: layout.height, transform: `scale(${scale})`, background: layout.backgroundColor, position: 'relative' }}>
        {layout.regions.map((r) => (
          <div key={r.id} style={{ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height, overflow: 'hidden', containerType: 'size', zIndex: r.zIndex }}>
            <RegionPlayer region={r}
              onPlay={report ? (w) => report(layout.id, r.id, w) : undefined}
              onError={onError ? (w, code, msg) => onError(r.id, w, code, msg) : undefined} />
          </div>
        ))}
      </div>
      <StatusBadge conn={conn} error={error} />
    </div>
  )
}

