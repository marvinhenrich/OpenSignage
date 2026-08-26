import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ApiError, api } from '../lib/api'
import type { IcingaGroup, IcingaProblem, IcingaProblemState, IcingaState, IcingaSummary, Region, Widget } from '../lib/api'

// Gemeinsames Widget-Rendering für Player, Editor-Vorschau UND Wall-Miniplayer.
//
// Der Renderer ist bewusst EINER: nur so ist garantiert, dass die Kachel auf der Wall
// dasselbe Bild ergibt wie das Gerät. Für die Wall gibt es lediglich einen sparsameren
// Betriebsmodus (`still`) — dieselben Komponenten, nur ohne Videodecoder, ohne iframes
// und ohne Sekundentakt-Timer, damit 30 Kacheln gleichzeitig laufen können.

export function mediaKey(w: Widget): string {
  return (w as any).mediaStorageKey ?? ''
}

// ---------------------------------------------------------------------------
// Umgebung des Renderers
//
// Derselbe Renderer laeuft an DREI Stellen mit unterschiedlicher Identitaet:
// im Player (Fernseher, KEINE Sitzung — weist sich mit dem Geraeteschluessel aus),
// im Layout-Editor und auf der Wall (angemeldete Sitzung). Widgets, die Serverdaten
// nachladen, brauchen deshalb die passende Quelle. Der Player fuellt `playerKey`
// (siehe pages/Player.tsx), ueberall sonst bleibt der Kontext leer — dadurch aendert
// sich fuer alle anderen Widgets nichts.
// ---------------------------------------------------------------------------
export interface RenderEnv {
  /** Geraete-Geheimnis (siehe server/src/lib/deviceAuth.ts). Nur der Player setzt es. */
  deviceKey?: string
  /** hardwareKey des Displays — nur im Player gesetzt. */
  playerKey?: string
}
const RenderEnvCtx = createContext<RenderEnv>({})

export function RenderEnvProvider({ playerKey, deviceKey, children }: { playerKey?: string; deviceKey?: string; children: React.ReactNode }) {
  const value = useMemo<RenderEnv>(() => ({ playerKey, deviceKey }), [playerKey, deviceKey])
  return <RenderEnvCtx.Provider value={value}>{children}</RenderEnvCtx.Provider>
}

export function useRenderEnv(): RenderEnv {
  return useContext(RenderEnvCtx)
}

/** Fehlerarten, die ein Player melden kann (Spiegel von server/src/ws/playerState.ts). */
export type PlayErrorCode = 'MEDIA_LOAD' | 'MEDIA_DECODE' | 'FRAME_LOAD' | 'CONTENT'

export interface WidgetViewProps {
  widget: Widget
  onEnded?: () => void
  /** Sparmodus für Kacheln: Standbild statt Wiedergabe, keine iframes, gedrosselte Timer. */
  still?: boolean
  /** Wiedergabefehler melden (Bild/Video/Audio/iframe lädt nicht). */
  onError?: (code: PlayErrorCode, message: string) => void
  /** Startzeitpunkt des Widgets auf dem Gerät (ms) — synchronisiert Video in der Großansicht. */
  startedAt?: number
}

function widgetLabel(w: Widget): string {
  return w.name || w.type
}

export function WidgetView({ widget, onEnded, still, onError, startedAt }: WidgetViewProps) {
  const o = (widget.options ?? {}) as Record<string, any>
  const wrap = 'absolute inset-0 h-full w-full'
  const fail = (code: PlayErrorCode, what: string) =>
    onError?.(code, `${what} konnte nicht geladen werden (${widgetLabel(widget)})`)

  switch (widget.type) {
    case 'image':
      return (
        <img src={`/media/${mediaKey(widget)}`} alt="" className={wrap} style={{ objectFit: o.fit ?? 'cover' }}
          loading={still ? 'lazy' : 'eager'} decoding="async"
          onError={() => fail('MEDIA_LOAD', 'Bild')} />
      )
    case 'video':
      return <VideoWidget widget={widget} options={o} className={wrap} still={still} startedAt={startedAt} onEnded={onEnded} onError={onError} />
    case 'audio':
      // Kein sichtbarer Inhalt — spielt die Tonspur ab und schaltet nach dem Ende weiter.
      if (still) return <TypePlaceholder label="Ton" detail={widgetLabel(widget)} />
      return <audio src={`/media/${mediaKey(widget)}`} autoPlay muted={o.sound !== true} onEnded={onEnded}
        onError={() => fail('MEDIA_LOAD', 'Tondatei')} />
    case 'embedded_html':
      if (still) return <TypePlaceholder label="HTML-Einbettung" detail={widgetLabel(widget)} />
      // WICHTIG: KEIN allow-same-origin bei srcDoc! Sonst laeuft der eingebettete Code in der
      // Ursprungsdomain des CMS und koennte Sitzung/Cookies eines angemeldeten Admins auslesen.
      // Ohne das Attribut bekommt der Rahmen eine eigene, isolierte Herkunft.
      return <iframe srcDoc={typeof o.html === 'string' ? o.html : ''} className={wrap} style={{ border: 0 }} sandbox="allow-scripts" title="embedded_html" onError={() => fail('FRAME_LOAD', 'HTML-Einbettung')} />
    case 'webpage':
      if (still) return <TypePlaceholder label="Webseite" detail={o.url || 'keine URL'} />
      // Fremde Seite: Skripte bleiben erlaubt (Signage braucht das), aber der Rahmen darf nicht
      // die Oberseite wegnavigieren, keine Fenster oeffnen und keine Downloads ausloesen.
      return <iframe src={o.url || 'about:blank'} className={wrap} style={{ border: 0 }} sandbox="allow-scripts allow-same-origin" title="webpage" onError={() => fail('FRAME_LOAD', 'Webseite')} />
    case 'pdf':
      if (still) return <TypePlaceholder label="PDF" detail={widgetLabel(widget)} />
      return <iframe src={`/media/${mediaKey(widget)}`} className={wrap} style={{ border: 0 }} title="pdf" onError={() => fail('FRAME_LOAD', 'PDF')} />
    case 'clock':
      // In der Kachel reicht ein 10-s-Takt (Minuten genügen) — spart 29 Timer bei 30 Kacheln.
      return <Clock format={o.format} tickMs={still ? 10000 : 1000} />
    case 'rss':
      return <RssWidget options={o} still={still} />
    case 'weather':
      return <WeatherWidget options={o} still={still} />
    case 'icinga':
      return <IcingaWidget options={o} still={still} />
    case 'text':
    default:
      if (o.scroll) {
        // Lauftext / Ticker (horizontal scrollend); in der Kachel steht er still.
        return (
          <div className={wrap} style={{
            display: 'flex', alignItems: 'center', overflow: 'hidden',
            color: o.color ?? '#ffffff', background: o.background ?? 'transparent',
            fontSize: o.fontSize ?? 48, fontWeight: o.bold ? 700 : 400,
          }}>
            <div style={{
              whiteSpace: 'nowrap', paddingLeft: '100%',
              animation: still ? 'none' : `marquee ${Math.max(5, o.scrollSeconds ?? 20)}s linear infinite`,
            }}>
              {o.text ?? ''}
            </div>
          </div>
        )
      }
      return (
        <div className={wrap} style={{
          display: 'flex', alignItems: o.valign ?? 'center', justifyContent: mapJustify(o.align),
          color: o.color ?? '#ffffff', background: o.background ?? 'transparent',
          fontSize: o.fontSize ?? 48, padding: 24, textAlign: (o.align ?? 'center') as any,
          fontWeight: o.bold ? 700 : 400, whiteSpace: 'pre-wrap', overflow: 'hidden',
        }}>
          {o.text ?? ''}
        </div>
      )
  }
}

/** Beschriftete Platzhalterfläche statt iframe/Audio-Element im Sparmodus der Kachel. */
function TypePlaceholder({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-300"
      style={{ padding: '3cqmin', textAlign: 'center', gap: '1cqmin' }}>
      <div style={{ fontSize: '6cqmin', fontWeight: 600 }}>{label}</div>
      {detail && <div style={{ fontSize: '4cqmin', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90%' }}>{detail}</div>}
    </div>
  )
}

/**
 * Video. Im Sparmodus (`still`) OHNE autoPlay und mit `#t=0.5`: der Browser dekodiert genau
 * ein Einzelbild statt einer Endlosschleife — das ist die entscheidende Sparmaßnahme,
 * damit 30 Kacheln nicht 30 Videodecoder starten.
 */
function VideoWidget(
  { widget, options, className, still, startedAt, onEnded, onError }:
  { widget: Widget; options: Record<string, any>; className: string; still?: boolean; startedAt?: number; onEnded?: () => void; onError?: (c: PlayErrorCode, m: string) => void },
) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const src = `/media/${mediaKey(widget)}`

  // Großansicht: an dieselbe Stelle im Video springen, an der das Gerät gerade steht.
  const onMeta = () => {
    const el = ref.current
    if (!el || still || !startedAt) return
    const d = el.duration
    if (!Number.isFinite(d) || d <= 0) return
    const pos = (Date.now() - startedAt) / 1000
    el.currentTime = Math.min(Math.max(pos, 0), Math.max(0, d - 0.2))
  }

  const handleError = () => {
    const code = ref.current?.error?.code
    onError?.(code === 3 ? 'MEDIA_DECODE' : 'MEDIA_LOAD',
      code === 3 ? `Video ist beschädigt oder nicht dekodierbar (${widgetLabel(widget)})` : `Video konnte nicht geladen werden (${widgetLabel(widget)})`)
  }

  if (still) {
    return (
      <>
        <video ref={ref} src={`${src}#t=0.5`} className={className} style={{ objectFit: options.fit ?? 'cover' }}
          muted playsInline preload="metadata" onError={handleError} />
        <div className="absolute flex items-center rounded bg-black/60 text-white"
          style={{ bottom: '2cqmin', right: '2cqmin', gap: '1cqmin', padding: '0.6cqmin 1.5cqmin', fontSize: '3.5cqmin' }}
          title="Video läuft auf dem Gerät — in der Kachel als Standbild">
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '4cqmin', height: '4cqmin' }} aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          {widget.durationSeconds > 0 && <span>{widget.durationSeconds}s</span>}
        </div>
      </>
    )
  }
  return (
    <video ref={ref} src={src} className={className} style={{ objectFit: options.fit ?? 'cover' }}
      autoPlay muted={options.sound !== true} playsInline
      onLoadedMetadata={onMeta} onEnded={onEnded} onError={handleError} />
  )
}

function mapJustify(align?: string) {
  return align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
}

/** Spielt die Widgets einer Region der Reihe nach ab (nach Dauer, in Schleife).
 *  onPlay wird bei jedem Widget-Wechsel aufgerufen (für Proof-of-Play + Wall-Zustand).
 *  onError meldet Wiedergabefehler des aktuellen Widgets nach oben. */
export function RegionPlayer(
  { region, onPlay, onError, still }:
  { region: Region; onPlay?: (w: Widget) => void; onError?: (w: Widget, code: PlayErrorCode, message: string) => void; still?: boolean },
) {
  const widgets = (region.playlist?.widgets ?? []).filter((w) => (w as any).enabled !== false)
  const [idx, setIdx] = useState(0)
  const sig = widgets.map((w) => w.id).join(',')

  // Immer die aktuelle Meldefunktion benutzen: sonst würde der Effekt unten mit einer
  // veralteten Closure melden (falsche Inhaltsfassung), wenn er nicht neu läuft.
  const playRef = useRef(onPlay)
  playRef.current = onPlay

  useEffect(() => { setIdx(0) }, [sig])
  useEffect(() => {
    if (widgets.length <= 1) return
    const cur = widgets[idx % widgets.length]
    // Video/Audio mit "Medienlänge verwenden": Weiterschaltung kommt aus onEnded, kein Timer (sonst abgehackt).
    const byMedia = (cur as any).useMediaDuration === true && (cur.type === 'video' || cur.type === 'audio')
    if (byMedia) return
    const t = setTimeout(() => setIdx((i) => (i + 1) % widgets.length), Math.max(1, cur.durationSeconds) * 1000)
    return () => clearTimeout(t)
  }, [idx, sig, widgets])
  // Meldet das laufende Widget nach oben (Proof-of-Play + Wall-Zustand).
  // `region` gehört zwingend in die Abhängigkeiten: bei einer neuen Inhaltsfassung bleiben
  // Widget-IDs (`sig`) und `idx` oft gleich, der gemeldete Zustand muss aber trotzdem neu
  // erhoben werden — sonst meldete der Player nach jedem Neuladen dauerhaft „keine Region".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (widgets.length) playRef.current?.(widgets[idx % widgets.length]) }, [idx, sig, region])

  if (widgets.length === 0) return null
  const w = widgets[idx % widgets.length]
  return (
    <WidgetView key={w.id} widget={w} still={still}
      onError={onError ? (code, msg) => onError(w, code, msg) : undefined}
      onEnded={() => setIdx((i) => (i + 1) % widgets.length)} />
  )
}

/**
 * Spiegel einer Region für die Wall: rendert GENAU das Widget, das das Gerät gemeldet hat —
 * statt selbst zu takten. Dadurch ist die Kachel nicht „auch so ein Player", sondern zeigt
 * denselben Stand wie das Display. Meldet das Gerät ein Widget, das im geladenen Layout gar
 * nicht (mehr) vorkommt, wird das ehrlich angezeigt statt still etwas Falsches gerendert.
 */
export function RegionMirror(
  { region, widgetId, startedAt, still }:
  { region: Region; widgetId: string | null; startedAt?: number; still?: boolean },
) {
  if (!widgetId) return null
  const w = (region.playlist?.widgets ?? []).find((x) => x.id === widgetId)
  if (!w) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-center text-amber-400"
        style={{ padding: '3cqmin', fontSize: '4cqmin' }}>
        Gerät spielt ein Widget, das in dieser Layout-Fassung nicht vorkommt
      </div>
    )
  }
  return <WidgetView key={w.id} widget={w} still={still} startedAt={startedAt} />
}

/** Vollflächige Sofort-Einblendung (Notfall-Overlay) — geteilt von Player und Wall.
 *  Nutzt Container-Einheiten, skaliert also in der Kachel genauso wie im Vollbild. */
export function EmergencyView(
  { emergency }:
  { emergency: { text: string; subtext?: string | null; color?: string | null; background?: string | null } },
) {
  return (
    <div style={{
      position: 'absolute', inset: 0, containerType: 'size',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '6cqw', textAlign: 'center',
      background: emergency.background ?? '#b91c1c', color: emergency.color ?? '#ffffff',
    }}>
      <div style={{ fontSize: '8cqw', fontWeight: 800, lineHeight: 1.1 }}>{emergency.text}</div>
      {emergency.subtext && <div style={{ fontSize: '3cqw', marginTop: '3cqh', opacity: 0.9 }}>{emergency.subtext}</div>}
    </div>
  )
}

function RssWidget({ options, still }: { options: Record<string, any>; still?: boolean }) {
  const url: string | undefined = options.url
  const [items, setItems] = useState<{ title: string; date?: string }[]>([])
  const [idx, setIdx] = useState(0)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!url) return
    let alive = true
    const fetchFeed = () => fetch(`/api/feed?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) { if (d.items) { setItems(d.items); setErr('') } else setErr(d.error ?? 'Feed-Fehler') } })
      .catch(() => alive && setErr('Feed nicht erreichbar'))
    fetchFeed()
    // Kachel: ein Abruf beim Mount reicht, kein Auffrischen (spart 30 Hintergrund-Timer).
    if (still) return () => { alive = false }
    const t = setInterval(fetchFeed, 300000)
    return () => { alive = false; clearInterval(t) }
  }, [url, still])
  useEffect(() => {
    if (still || items.length <= 1) return
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), Math.max(3, options.interval ?? 8) * 1000)
    return () => clearInterval(t)
  }, [items, options.interval, still])

  const box = 'absolute inset-0 flex flex-col justify-center'
  if (!url) return <div className={box} style={{ padding: '4cqmin', color: '#94a3b8', fontSize: '4cqmin' }}>RSS: keine URL konfiguriert</div>
  if (err) return <div className={box} style={{ padding: '4cqmin', color: '#f87171', fontSize: '4cqmin' }}>{err}</div>
  if (items.length === 0) return <div className={box} style={{ padding: '4cqmin', color: '#94a3b8', fontSize: '4cqmin' }}>Lade Feed…</div>
  const it = items[idx % items.length]
  return (
    <div className={box} style={{ padding: '4cqmin', background: options.background ?? 'transparent', color: options.color ?? '#ffffff' }}>
      <div style={{ fontSize: `${options.fontSize ? options.fontSize / 10 : 8}cqmin`, fontWeight: 700, lineHeight: 1.15 }}>{it.title}</div>
      {it.date && <div style={{ fontSize: '3.2cqmin', marginTop: '2cqmin', opacity: 0.7 }}>{it.date}</div>}
    </div>
  )
}

function wmo(code: number): { label: string; cat: 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog' } {
  if (code === 0) return { label: 'Klar', cat: 'sun' }
  if (code <= 2) return { label: 'Teils bewölkt', cat: 'cloud' }
  if (code === 3) return { label: 'Bewölkt', cat: 'cloud' }
  if (code === 45 || code === 48) return { label: 'Nebel', cat: 'fog' }
  if (code >= 51 && code <= 57) return { label: 'Niesel', cat: 'rain' }
  if (code >= 61 && code <= 67) return { label: 'Regen', cat: 'rain' }
  if (code >= 71 && code <= 77) return { label: 'Schnee', cat: 'snow' }
  if (code >= 80 && code <= 82) return { label: 'Regenschauer', cat: 'rain' }
  if (code >= 85 && code <= 86) return { label: 'Schneeschauer', cat: 'snow' }
  if (code >= 95) return { label: 'Gewitter', cat: 'storm' }
  return { label: 'Wechselhaft', cat: 'cloud' }
}

function WeatherWidget({ options, still }: { options: Record<string, any>; still?: boolean }) {
  const location: string = options.location || 'Berlin'
  const [w, setW] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    const fetchW = () => fetch(`/api/weather?location=${encodeURIComponent(location)}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; if (d.error) setErr(d.error); else { setW(d); setErr('') } })
      .catch(() => alive && setErr('Wetter nicht verfügbar'))
    fetchW()
    if (still) return () => { alive = false }
    const t = setInterval(fetchW, 900000)
    return () => { alive = false; clearInterval(t) }
  }, [location, still])

  const box: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', color: options.color ?? '#ffffff', background: options.background ?? 'transparent' }
  if (err) return <div style={{ ...box, color: '#f87171', fontSize: '4cqmin' }}>{err}</div>
  if (!w) return <div style={{ ...box, color: '#94a3b8', fontSize: '4cqmin' }}>Lade Wetter…</div>
  const c = wmo(w.code)
  return (
    <div style={box}>
      <div style={{ fontSize: '6cqmin', opacity: 0.85 }}>{w.city}</div>
      <div style={{ fontSize: '26cqmin', fontWeight: 700, lineHeight: 1 }}>{w.temp}°</div>
      <div style={{ fontSize: '6cqmin' }}>{c.label}</div>
      <div style={{ fontSize: '4cqmin', opacity: 0.7, marginTop: '2cqmin' }}>↑{w.max}° ↓{w.min}° · Wind {w.wind} km/h</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Icinga — Monitoring-Bausteine
//
// Gestaltungsregeln (die nicht offensichtlichen):
//  - Die Kachel bringt ihr Aussehen SELBST mit: Inline-Farben, KEIN `dark:`. Sie laeuft
//    auf einem Fernseher und darf weder am Theme des Admins noch an der Hintergrundfarbe
//    des Layouts haengen.
//  - Kontraste werden gerechnet, nicht geraten (`icReadable`): jede Statusfarbe wird so
//    weit auf- oder abgedunkelt, bis sie 4,5:1 nach WCAG erreicht - auf dem Grund UND auf
//    der getoenten Zeile.
//  - Statusfarben wie in Icinga Web 2. Die REINEN Toene tragen Flaechen und bleiben in
//    jedem Theme gleich; Text bekommt die kontrastgeprueften Varianten.
//  - Duenne helle Trennlinien verschwinden aus 3-5 m Abstand (auf Dunkel umgekehrt).
//  - Keine dekorativen Piktogramme. Farbe zeigt Aufmerksamkeit, nicht Normalitaet: nur
//    ein OFFENES Problem wird eingefaerbt.

const IC_MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
/**
 * Grundschrift der Kachel — dieselbe Reihe wie im CMS (`tailwind.config.js`).
 * Sie steht ausdruecklich AUF der Kachel: der Fernseher rendert das Widget in einer
 * nackten Player-Seite, ohne die Schriftvorgabe des Admin-Themes. Ohne diese Zeile
 * faellt der Browser dort auf seine Standardschrift (Serife) zurueck.
 */
const IC_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

// --- Farb- und Kontrastrechnung (WCAG 2.1) ---------------------------------
// Der Nutzer darf eine beliebige Hintergrundfarbe waehlen. Damit er sich damit nicht
// unlesbar stellt (Dunkelblau + schwarze Schrift), wird jede Farbe der Kachel aus
// dieser Grundfarbe BERECHNET statt geraten.

function icHex(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (full.length < 6) return [255, 255, 255]
  const n = Number.parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(n)) return [255, 255, 255]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function icRgb(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** Relativluminanz nach WCAG 2.1 — Grundlage jeder Kontrastentscheidung. */
function icLum(hex: string): number {
  const [r, g, b] = icHex(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Kontrastverhaeltnis zweier Farben (1:1 bis 21:1). */
function icContrast(a: string, b: string): number {
  const la = icLum(a)
  const lb = icLum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function icMix(a: string, b: string, t: number): string {
  const A = icHex(a)
  const B = icHex(b)
  return icRgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t])
}

/**
 * Luminanz, ab der Schwarz auf dem Grund besser traegt als Weiss.
 * Rechnerisch der Punkt, an dem beide Kontraste gleich sind: sqrt(1.05*0.05) - 0.05.
 */
const IC_INK_SWITCH = Math.sqrt(1.05 * 0.05) - 0.05

/**
 * Farbe so weit ab- bzw. aufhellen, bis sie das WCAG-Ziel auf `bg` erreicht.
 * Richtung ergibt sich aus dem Grund: auf hellem Grund nach Schwarz, auf dunklem
 * nach Weiss. Halbierungssuche, damit der Ton so weit wie moeglich erhalten bleibt.
 */
function icReadable(fg: string, bg: string, target = 4.5): string {
  if (icContrast(fg, bg) >= target) return fg
  const to = icLum(bg) > IC_INK_SWITCH ? '#000000' : '#ffffff'
  let lo = 0
  let hi = 1
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    if (icContrast(icMix(fg, to, mid), bg) >= target) hi = mid
    else lo = mid
  }
  const out = icMix(fg, to, hi)
  return icContrast(out, bg) >= target ? out : to
}

/** Reine Icinga-Toene (Icinga Web 2). Sie tragen in JEDEM Theme die Flaechen. */
const IC_FILL: Record<IcingaState, string> = {
  critical: '#ff5566',
  warning: '#ffaa44',
  unknown: '#aa44ff',
  ok: '#44bb77',
}

export type IcingaTheme = 'hell' | 'gedaempft' | 'dunkel'

/** Auswahl im Layout-Editor — eine Quelle fuer Renderer und Bedienoberflaeche. */
export const ICINGA_THEMES: { value: IcingaTheme; label: string; hint: string }[] = [
  { value: 'hell', label: 'Hell', hint: 'weiße Karte wie im CMS (Standard)' },
  { value: 'gedaempft', label: 'Gedämpft', hint: 'heller Grauton statt Weiß' },
  { value: 'dunkel', label: 'Dunkel', hint: 'dunkle Karte für abgedunkelte Räume' },
]

const IC_THEME_BG: Record<IcingaTheme, string> = { hell: '#ffffff', gedaempft: '#e8ecf1', dunkel: '#111a27' }

interface IcingaTone {
  /** Text und Zahlen — kontrastgeprueft auf Grund UND Toenung. */
  color: string
  /** Reiner Icinga-Ton fuer Flaechen (Kantenbalken, Quadrate, Balken). */
  fill: string
  /** Zeilenhintergrund wie in Icingas Listen. */
  tint: string
  /** Rahmen der getoenten Zeile, damit sie eine Kante behaelt. */
  edge: string
}

interface IcingaSkin {
  dark: boolean
  /** Kartenflaeche. */
  bg: string
  /** Ruhiges Band innerhalb der Karte (Zahlenband). */
  panel: string
  /** Neutrale Zeilenflaeche fuer alles, was kein Problem meldet. */
  row: string
  /** Spur eines Fuellbalkens. */
  track: string
  /** Aussenkante der Karte. */
  edge: string
  /** Innere Trennlinien. */
  line: string
  /** Zahlen und Objektnamen. */
  txt: string
  /** Begleittext (Dienstname, Dauer). */
  dim: string
  /** Kleine Versalien-Beschriftungen. */
  mute: string
  shadow: string
  st: Record<IcingaState, IcingaTone>
}

/** Der bisherige helle Stil — unveraendert, damit Bestandswidgets exakt gleich bleiben. */
const IC_SKIN_HELL: IcingaSkin = {
  dark: false,
  bg: '#ffffff',
  panel: '#f8fafc',
  row: '#f1f5f9',
  track: '#e2e8f0',
  edge: '#e2e8f0',
  line: '#cbd5e1',
  txt: '#0f172a',
  dim: '#334155',
  mute: '#475569',
  shadow: '0 0.15cqmin 0.5cqmin rgba(15,23,42,0.10), 0 0.05cqmin 0.15cqmin rgba(15,23,42,0.06)',
  st: {
    critical: { color: '#c02434', fill: '#ff5566', tint: '#ffe7ea', edge: '#ffc4c9' },
    warning: { color: '#9a5b00', fill: '#ffaa44', tint: '#fff3e5', edge: '#ffe1be' },
    unknown: { color: '#8127e0', fill: '#aa44ff', tint: '#f3e5ff', edge: '#e1beff' },
    ok: { color: '#177a45', fill: '#44bb77', tint: '#e5f5ec', edge: '#bee7cf' },
  },
}

/**
 * Vollstaendige Palette aus einer Hintergrundfarbe ableiten.
 * Auf Weiss angewandt ergibt das nahezu exakt den hellen CMS-Stil oben — die
 * Rechnung ist also an der bestehenden Gestaltung geeicht, nicht frei erfunden.
 */
function icingaDerive(bg: string): IcingaSkin {
  // Welche Schrift traegt auf diesem Grund besser? Das entscheidet die Luminanz,
  // nicht das Gefuehl — sonst stellt jemand Dunkelblau ein und liest nichts mehr.
  const dark = icLum(bg) <= IC_INK_SWITCH
  const ink = dark ? '#f8fafc' : '#0f172a'
  const st = {} as Record<IcingaState, IcingaTone>
  for (const k of ['critical', 'warning', 'unknown', 'ok'] as IcingaState[]) {
    const fill = IC_FILL[k]
    const tint = icMix(bg, fill, dark ? 0.22 : 0.13)
    const edge = icMix(bg, fill, dark ? 0.45 : 0.32)
    // Zweimal pruefen: die Zahl steht mal auf der Karte, mal in der getoenten Zeile.
    st[k] = { fill, tint, edge, color: icReadable(icReadable(fill, bg, 4.5), tint, 4.5) }
  }
  return {
    dark,
    bg,
    panel: icMix(bg, ink, dark ? 0.06 : 0.03),
    row: icMix(bg, ink, dark ? 0.11 : 0.06),
    track: icMix(bg, ink, dark ? 0.20 : 0.14),
    edge: icMix(bg, ink, dark ? 0.20 : 0.12),
    line: icMix(bg, ink, dark ? 0.34 : 0.24),
    // Auch die Begleitschrift wird gerechnet, nicht nur die Statusfarben: auf einem
    // Fernseher aus 3-5 m ist eine graue 5:1-Beschriftung schon zu schwach. Die Ziele
    // liegen deshalb dort, wo der bestehende helle Stil steht (17,9 / 10,4 / 7,6).
    txt: icReadable(ink, bg, 12),
    dim: icReadable(icMix(ink, bg, 0.22), bg, 9.5),
    mute: icReadable(icMix(ink, bg, 0.38), bg, 7),
    shadow: dark
      ? '0 0.15cqmin 0.6cqmin rgba(0,0,0,0.45), 0 0.05cqmin 0.15cqmin rgba(0,0,0,0.30)'
      : '0 0.15cqmin 0.5cqmin rgba(15,23,42,0.10), 0 0.05cqmin 0.15cqmin rgba(15,23,42,0.06)',
    st,
  }
}

const IC_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
/** Einmal gerechnete Paletten behalten — die Ableitung laeuft sonst bei jedem Takt neu. */
const icSkinCache = new Map<string, IcingaSkin>()

function icingaSkin(theme: IcingaTheme, background?: unknown): IcingaSkin {
  const bg = typeof background === 'string' && IC_HEX_RE.test(background.trim()) ? background.trim().toLowerCase() : ''
  // Weiss ist immer der CMS-Stil — egal ob als Theme oder ausdruecklich gewaehlt.
  if (bg === '#ffffff' || bg === '#fff' || (!bg && theme === 'hell')) return IC_SKIN_HELL
  const key = `${theme}|${bg}`
  let sk = icSkinCache.get(key)
  if (!sk) {
    sk = icingaDerive(bg || IC_THEME_BG[theme])
    icSkinCache.set(key, sk)
  }
  return sk
}

/**
 * Die Palette liegt im Kontext statt in Modulkonstanten: jeder Baustein malt sich
 * selbst, ohne dass die Farbe durch ein Dutzend Komponenten gereicht werden muss.
 * Voreinstellung ist der helle Stil — Bestandswidgets sehen damit aus wie bisher.
 */
const IcingaSkinCtx = createContext<IcingaSkin>(IC_SKIN_HELL)
/** Sparmodus (Wall-Vorschau): dann tickt die Sekundenanzeige nicht. */
const IcingaStillCtx = createContext<boolean>(false)
const useSkin = (): IcingaSkin => useContext(IcingaSkinCtx)

/** Haarlinie: mindestens 1 px, waechst auf grossen Layouts auf ~2 px mit. */
const icHair = (s: IcingaSkin) => `max(1px, 0.16cqmin) solid ${s.line}`

/**
 * Hoehenbudget der Baender in cqmin — Grundlage der Zeilenberechnung.
 * `edge` ist der schmale Rand um die Karte herum (der „Kartenabstand" wie im CMS)
 * und geht in jede Platzrechnung mit ein, sonst waere das Budget um 2×edge zu gross.
 */
const IC_CQ = {
  edge: 0.9, pad: 2.6, gap: 1.8, header: 6.4, strip: 20, chips: 5.2, foot: 4.4,
  rowA: 11.5, rowB: 7.2, rowGap: 0.8, more: 5,
  /** Kopfzeile eines Nebenpanels (Gruppen, Zuletzt erholt, Bestaetigt). */
  section: 4.4,
  /** Zeile der Gruppen-Leiste. */
  grpRow: 5.4,
  /** Zeile in einer Nebenliste (erholt / bestaetigt). */
  side: 6.6,
  /** Schlusszeile „+ N weitere" in einer Nebenspalte (schmaler als `more`). */
  moreSide: 3.4,
  /** Verlaufsstreifen in der Gesamtuebersicht. */
  spark: 13,
  /** Band „laengste offene Meldung". */
  oldest: 6.4,
}

/** Wie viele Zeilen der Hoehe `row` passen in `avail`? */
function icFit(avail: number, row: number, extra = 0, gap = IC_CQ.rowGap): number {
  return Math.max(0, Math.floor((avail - extra + gap) / (row + gap)))
}

/**
 * Sekundentakt fuer Altersangaben. Ohne ihn wuerde nur beim 30-s-Abruf neu gerechnet und
 * "vor X" spraenge in 30-Sekunden-Stufen (22 s -> 50 s -> 1 min). EIN Timer fuer alle
 * Kacheln; im Sparmodus der Wall-Vorschau bleibt er aus.
 */
let icNow = Date.now()
const icTickSubs = new Set<() => void>()
let icTickTimer: ReturnType<typeof setInterval> | null = null
function icSubscribeTick(cb: () => void) {
  icTickSubs.add(cb)
  if (!icTickTimer) icTickTimer = setInterval(() => { icNow = Date.now(); for (const f of icTickSubs) f() }, 1000)
  return () => {
    icTickSubs.delete(cb)
    if (icTickSubs.size === 0 && icTickTimer) { clearInterval(icTickTimer); icTickTimer = null }
  }
}
const icNoTick = () => () => {}
function useIcingaNow(fallback: number): number {
  const still = useContext(IcingaStillCtx)
  const now = useSyncExternalStore(still ? icNoTick : icSubscribeTick, () => icNow, () => icNow)
  return still ? fallback : now
}

function icingaClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

/** Alter einer Meldung, knapp und tabellarisch — auf 5 m zaehlt die Groessenordnung. */
function icingaAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  // Umbruch bei genau 60 s. Frueher lief der Zaehler bis 89 s ("73 s", "74 s"),
  // um "1 min" bei 61 s zu vermeiden - gelesen wird das aber als Fehler.
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} Std`
  return `${Math.floor(h / 24)} Tg`
}

/** Laufzeit von Icinga — kurze Werte verraten einen unbemerkten Neustart. */
function icingaUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} Std ${m % 60} min`
  return `${Math.floor(h / 24)} Tg ${h % 24} Std`
}

/**
 * Zeitspanne mit passender Einheit. Icingas Latenz liegt oft im Mikrosekundenbereich
 * (z.B. 0,000005 s) - als "0,00 s" waere das nichtssagend und sieht nach Fehler aus.
 * Deshalb wird die Einheit mitgewaehlt und sehr kleine Werte ehrlich als "< 1 ms" gezeigt.
 */
function icingaSeconds(v: number): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return '–'
  if (n === 0) return '0 ms'
  if (n < 0.001) return '< 1 ms'
  if (n < 1) return `${(n * 1000).toLocaleString('de-DE', { maximumFractionDigits: n < 0.01 ? 1 : 0 })} ms`
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`
}

/** Klartext-Fehler fuer die Kachel — nie eine leere Flaeche, immer eine verortbare Meldung. */
function icingaMessage(e: unknown, viaPlayer: boolean): string {
  if (!(e instanceof ApiError)) return 'Monitoring-Status konnte nicht geladen werden.'
  if (e.status === 401) return 'Nicht angemeldet — die Vorschau kann die Monitoring-Daten nicht laden. [UNAUTHORIZED]'
  if (e.status === 403 && !viaPlayer) return 'Keine Berechtigung: Monitoring-Daten sind nur für Administratoren sichtbar. [FORBIDDEN]'
  return e.message
}

// --- Bausteine -------------------------------------------------------------
// Ein Widget-Typ, mehrere Ansichten: aus denselben Serverdaten baut sich der Admin
// seine eigene Uebersicht zusammen, indem er je Baustein eine eigene Region anlegt.

export type IcingaView =
  | 'overview' | 'status' | 'count' | 'services' | 'hosts' | 'problems' | 'groups' | 'health' | 'recovered' | 'trend'
export type IcingaMetric =
  | 'services_critical' | 'services_warning' | 'services_unknown' | 'services_ok' | 'services_total'
  | 'hosts_down' | 'hosts_unreachable' | 'hosts_up' | 'hosts_total'
  | 'acknowledged' | 'in_downtime' | 'stale_checks' | 'problems_total' | 'recovered_hour'

/** Auswahl im Layout-Editor — eine Quelle fuer Renderer und Bedienoberflaeche. */
export const ICINGA_VIEWS: { value: IcingaView; label: string; hint: string }[] = [
  { value: 'overview', label: 'Gesamtübersicht', hint: 'Zahlen, Meldungen, Gruppen, Verlauf' },
  { value: 'status', label: 'Ampel', hint: 'nur das Gesamturteil, sehr groß' },
  { value: 'count', label: 'Einzelzahl', hint: 'eine einzelne Kennzahl, sehr groß' },
  { value: 'services', label: 'Dienste', hint: 'die Dienst-Zahlen je Status' },
  { value: 'hosts', label: 'Hosts', hint: 'die Host-Zahlen je Status' },
  { value: 'problems', label: 'Problemliste', hint: 'offene Meldungen mit Dauer' },
  { value: 'groups', label: 'Gruppen', hint: 'Gesundheit je Gruppe, betroffene oben' },
  { value: 'recovered', label: 'Zuletzt erholt', hint: 'was sich von selbst gefangen hat' },
  { value: 'trend', label: 'Verlauf', hint: 'wird es besser oder schlechter' },
  { value: 'health', label: 'Icinga-Zustand', hint: 'Prüfrate, Laufzeit, Version' },
]
export const ICINGA_METRICS: { value: IcingaMetric; label: string }[] = [
  { value: 'services_critical', label: 'Kritische Dienste' },
  { value: 'services_warning', label: 'Dienste mit Warnung' },
  { value: 'services_unknown', label: 'Dienste unbekannt' },
  { value: 'services_ok', label: 'Dienste in Ordnung' },
  { value: 'services_total', label: 'Dienste gesamt' },
  { value: 'hosts_down', label: 'Hosts ausgefallen' },
  { value: 'hosts_unreachable', label: 'Hosts unerreichbar' },
  { value: 'hosts_up', label: 'Hosts erreichbar' },
  { value: 'hosts_total', label: 'Hosts gesamt' },
  { value: 'acknowledged', label: 'Ausgeblendete Meldungen' },
  { value: 'in_downtime', label: 'In Wartung' },
  { value: 'stale_checks', label: 'Überfällige Prüfungen' },
  { value: 'problems_total', label: 'Offene Meldungen' },
  { value: 'recovered_hour', label: 'Erholt (letzte Stunde)' },
]

/** Meldungszustaende (Dienst UND Host) auf Schwere und Kurzwort abbilden. */
const IC_PROBLEM: Record<IcingaProblemState, { sev: IcingaState; short: string }> = {
  down: { sev: 'critical', short: 'AUS' },
  critical: { sev: 'critical', short: 'KRIT' },
  unreachable: { sev: 'unknown', short: 'UNERR' },
  unknown: { sev: 'unknown', short: 'UNBEK' },
  warning: { sev: 'warning', short: 'WARN' },
}

const IC_RANK: Record<IcingaState, number> = { ok: 0, unknown: 1, warning: 2, critical: 3 }

/** Schwerster Zustand einer Meldungsliste. */
function icingaSeverity(list: { state: IcingaProblemState }[]): IcingaState {
  let sev: IcingaState = 'ok'
  for (const x of list) {
    const s = IC_PROBLEM[x.state]?.sev ?? 'unknown'
    if (IC_RANK[s] > IC_RANK[sev]) sev = s
  }
  return sev
}

/**
 * Gesamturteil — bewusst aus den OFFENEN Meldungen, nicht aus den Rohzahlen:
 * was bestaetigt oder in Wartung ist, wird bearbeitet und darf das Board nicht rot faerben.
 * Ueberfaellige Pruefungen zaehlen mit, weil ein stiller Ausfall gefaehrlicher ist als ein rotes Feld.
 */
function icingaWorst(d: IcingaSummary): IcingaState {
  let sev = icingaSeverity(d.problems)
  if (d.staleChecks > 0 && IC_RANK.warning > IC_RANK[sev]) sev = 'warning'
  return sev
}

/** Kennzahl fuer den Einzelzahl-Baustein: Wert, Beschriftung, Marker und ob sie faerbt. */
function icingaMetricValue(d: IcingaSummary, m: IcingaMetric): {
  value: number; label: string; state?: IcingaState; hot?: boolean; capped?: boolean
} {
  switch (m) {
    case 'services_warning': return { value: d.services.warning, label: 'Dienste mit Warnung', state: 'warning', hot: true }
    case 'services_unknown': return { value: d.services.unknown, label: 'Dienste unbekannt', state: 'unknown', hot: true }
    case 'services_ok': return { value: d.services.ok, label: 'Dienste in Ordnung', state: 'ok' }
    case 'services_total': return { value: d.totals.services, label: 'Dienste gesamt' }
    case 'hosts_down': return { value: d.hosts.down, label: 'Hosts ausgefallen', state: 'critical', hot: true }
    case 'hosts_unreachable': return { value: d.hosts.unreachable, label: 'Hosts unerreichbar', state: 'unknown', hot: true }
    case 'hosts_up': return { value: d.hosts.up, label: 'Hosts erreichbar', state: 'ok' }
    case 'hosts_total': return { value: d.totals.hosts, label: 'Hosts gesamt' }
    case 'acknowledged': return { value: d.hosts.acknowledged + d.services.acknowledged, label: 'Ausgeblendete Meldungen', state: 'warning' }
    case 'in_downtime': return { value: d.hosts.inDowntime + d.services.inDowntime, label: 'In Wartung', state: 'unknown' }
    case 'stale_checks': return { value: d.staleChecks, label: 'Überfällige Prüfungen', state: 'critical', hot: true }
    case 'recovered_hour': return { value: d.recovered.length, label: 'Erholt (letzte Stunde)', state: 'ok' }
    case 'problems_total': {
      // Der Server liefert hoechstens 30 Meldungen — bei voller Liste ehrlich als „30+" zeigen.
      return {
        value: d.problems.length, label: 'Offene Meldungen', state: icingaSeverity(d.problems),
        hot: true, capped: d.problems.length >= 30,
      }
    }
    case 'services_critical':
    default: return { value: d.services.critical, label: 'Kritische Dienste', state: 'critical', hot: true }
  }
}

// --- Gemeinsamer Abruf -----------------------------------------------------
/**
 * Alle Icinga-Bausteine einer Seite teilen sich EINEN Abruf je Quelle.
 *
 * Zehn Bausteine auf einem Layout duerfen nicht zehn Anfragen ausloesen. Daten,
 * laufende Anfrage und Takt liegen deshalb modulweit je Pfad: der erste Baustein holt,
 * alle anderen lesen mit, und es laeuft genau EIN 30-s-Takt, solange mindestens ein
 * Baustein live gerendert wird (Wall-Kacheln im Sparmodus takten gar nicht).
 */
const IC_TTL = 30_000

interface IcingaEntry {
  data?: IcingaSummary
  /** Zeitpunkt der letzten ERFOLGREICHEN Antwort — bleibt bei einem Fehler erhalten. */
  dataAt?: number
  error?: string
  /** Zeitpunkt des letzten Versuchs, egal ob erfolgreich. */
  at: number
}
interface IcingaSourceState {
  entry: IcingaEntry | null
  subs: Set<() => void>
  inflight: Promise<void> | null
  timer: ReturnType<typeof setInterval> | null
  /** Anzahl der Bausteine, die einen laufenden Takt brauchen (alle ausser Wall-Kacheln). */
  live: number
}
const icingaSources = new Map<string, IcingaSourceState>()

function icingaSource(path: string): IcingaSourceState {
  let s = icingaSources.get(path)
  if (!s) {
    s = { entry: null, subs: new Set(), inflight: null, timer: null, live: 0 }
    icingaSources.set(path, s)
  }
  return s
}

/** Holt hoechstens einmal je 30 s und hoechstens einmal gleichzeitig. */
function icingaFetch(path: string, viaPlayer: boolean, force = false): void {
  const s = icingaSource(path)
  if (s.inflight) return
  if (!force && s.entry && Date.now() - s.entry.at < IC_TTL) return
  s.inflight = api.get<IcingaSummary>(path)
    .then((data) => { s.entry = { data, dataAt: Date.now(), at: Date.now() } })
    .catch((e) => {
      // Letzten guten Stand behalten: die Bausteine kennzeichnen ihn dann als veraltet,
      // statt auf dem Fernseher schlagartig leer zu werden.
      s.entry = { data: s.entry?.data, dataAt: s.entry?.dataAt, error: icingaMessage(e, viaPlayer), at: Date.now() }
    })
    .finally(() => { s.inflight = null; for (const cb of s.subs) cb() })
}

function useIcingaData(path: string, viaPlayer: boolean, still?: boolean): IcingaEntry | null {
  const [, bump] = useState(0)
  useEffect(() => {
    const s = icingaSource(path)
    const cb = () => bump((n) => n + 1)
    s.subs.add(cb)
    if (!still) {
      s.live++
      if (!s.timer) s.timer = setInterval(() => icingaFetch(path, viaPlayer, true), IC_TTL)
    }
    // Beim Auftauchen Daten sicherstellen; der 30-s-Cache verhindert, dass der zweite,
    // dritte, ... Baustein ueberhaupt eine Anfrage ausloest.
    icingaFetch(path, viaPlayer)
    return () => {
      s.subs.delete(cb)
      if (!still) {
        s.live--
        if (s.live <= 0 && s.timer) { clearInterval(s.timer); s.timer = null }
      }
    }
  }, [path, viaPlayer, still])
  return icingaSource(path).entry
}

// --- Grundbausteine der Gestaltung -----------------------------------------

const IC_ELL: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

/** Beschriftung: klein, Versalien, Laufweite, gedaempft. Traegt die Bedeutung mit. */
function IcingaCap({ text, size = '2.6cqmin', color }: { text: string; size?: string; color?: string }) {
  const s = useSkin()
  return (
    <span style={{
      fontSize: size, letterSpacing: '0.14em', textTransform: 'uppercase', color: color ?? s.mute,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>{text}</span>
  )
}

/**
 * Minimaler geometrischer Marker — ein kleines Quadrat, kein Piktogramm.
 * Es bekommt zusaetzlich eine feine Kante in der kontrastgeprueften Statusvariante:
 * ein reines #ffaa44-Quadrat haette gegen Weiss nur 1,9:1 und wuerde ausfransen.
 */
function IcingaDot({ state, size = '1.5cqmin' }: { state: IcingaState; size?: string }) {
  const s = useSkin()
  return (
    <span aria-hidden="true" style={{
      flex: 'none', width: size, height: size, background: s.st[state].fill,
      boxShadow: `inset 0 0 0 max(1px, 0.06cqmin) ${s.st[state].color}`,
    }} />
  )
}

/**
 * Kennzahl im Stil einer Wallboard-Zelle: Beschriftung, grosse Tabellenziffern, Zusatz.
 *
 * Die Zelle ist ihr EIGENER Groessen-Container, die Innenmasse beziehen sich also auf die
 * Zelle. Dadurch sitzt dieselbe Zelle in der schmalen Uebersichtsspalte genauso wie
 * formatfuellend im eigenen Baustein — mit zwei Grenzen zugleich (`min()` aus Hoehe und
 * Breite), damit weder Beschriftung abgeschnitten noch die Zahl zu breit wird.
 */
function IcingaStat(
  { label, value, sub, state, hot, scale = 1, wrap }:
  { label: string; value: string; sub?: string; state?: IcingaState; hot?: boolean; scale?: number; wrap?: boolean },
) {
  const s = useSkin()
  const d = value.length
  const capW = d <= 1 ? 62 : d === 2 ? 46 : d === 3 ? 32 : d === 4 ? 24 : 19
  const colored = hot && state && value !== '0'
  return (
    // Groessen-Container: die Innenmasse beziehen sich auf die Zelle. Wichtig dabei:
    // ein solcher Container traegt selbst NICHTS zur eigenen Groesse bei — er braucht
    // deshalb eine von aussen gesetzte Groesse (hier 100 % der definierten Zelle).
    <div style={{ width: '100%', height: '100%', containerType: 'size', overflow: 'hidden' }}>
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center',
        gap: '2cqh', padding: '4cqh 5cqw',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3cqw', minWidth: 0 }}>
          {state && (
            <span aria-hidden="true" style={{
              flex: 'none', width: 'min(7cqh,6cqw)', height: 'min(7cqh,6cqw)', background: s.st[state].fill,
              boxShadow: `inset 0 0 0 max(1px, 0.4cqh) ${s.st[state].color}`,
            }} />
          )}
          <span style={{
            minWidth: 0, fontSize: 'min(11cqh, 9cqw)', letterSpacing: '0.14em', textTransform: 'uppercase',
            color: s.mute, lineHeight: 1.15,
            ...(wrap
              ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }
              : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
          }}>{label}</span>
        </div>
        <div style={{
          fontFamily: IC_MONO, fontSize: `min(${42 * scale}cqh, ${capW * scale}cqw)`, fontWeight: 600,
          lineHeight: 1, letterSpacing: '-0.02em', color: colored ? s.st[state].color : s.txt,
        }}>{value}</div>
        {sub && (
          <div style={{ minWidth: 0, display: 'flex' }}><IcingaCap text={sub} size="min(8cqh, 7cqw)" color={s.dim} /></div>
        )}
      </div>
    </div>
  )
}

/** Reihe aus Kennzahlen, durch Haarlinien getrennt (kein Kachel-Look). */
function IcingaStatGrid(
  { items, cols, rows }:
  { items: { label: string; value: string; sub?: string; state?: IcingaState; hot?: boolean }[]; cols: number; rows: number },
) {
  const s = useSkin()
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
    }}>
      {items.map((it, i) => (
        <div key={i} style={{
          minWidth: 0, minHeight: 0, overflow: 'hidden',
          borderLeft: i % cols === 0 ? undefined : icHair(s),
          borderTop: i < cols ? undefined : icHair(s),
        }}>
          <IcingaStat {...it} />
        </div>
      ))}
    </div>
  )
}

/** Kopfzeile eines Nebenpanels: Beschriftung links, Zusatz rechts, Haarlinie darunter. */
function IcingaSection({ title, right, rightColor }: { title: string; right?: string; rightColor?: string }) {
  const s = useSkin()
  return (
    <div style={{
      flex: 'none', height: `${IC_CQ.section}cqmin`, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: '1.6cqmin', borderBottom: icHair(s), overflow: 'hidden',
    }}>
      <IcingaCap text={title} size="2.7cqmin" color={s.dim} />
      {right && <IcingaCap text={right} size="2.6cqmin" color={rightColor} />}
    </div>
  )
}

function IcingaWidget({ options, still }: { options: Record<string, any>; still?: boolean }) {
  const { playerKey, deviceKey } = useRenderEnv()
  // Bestandsschutz: aeltere Widgets kennen nur „nur Probleme zeigen" — das ist heute
  // der Baustein „Problemliste". Ohne jede Option bleibt es bei der Gesamtuebersicht.
  const view: IcingaView = ICINGA_VIEWS.some((v) => v.value === options.view)
    ? options.view as IcingaView
    : options.onlyProblems === true ? 'problems' : 'overview'
  const metric: IcingaMetric = ICINGA_METRICS.some((m) => m.value === options.metric)
    ? options.metric as IcingaMetric
    : 'services_critical'
  const maxRows = Math.min(30, Math.max(1, Math.round(Number(options.maxProblems)) || 6))
  // Aussehen: Theme und optionale eigene Hintergrundfarbe. Ohne beides bleibt es beim
  // hellen CMS-Stil — Bestandswidgets sehen also unveraendert aus.
  const theme: IcingaTheme = ICINGA_THEMES.some((t) => t.value === options.theme) ? options.theme as IcingaTheme : 'hell'
  const skin = useMemo(() => icingaSkin(theme, options.background), [theme, options.background])

  const rootRef = useRef<HTMLDivElement>(null)
  // Regionsmasse in cqmin (der kleinere Wert ist immer 100).
  const [size, setSize] = useState({ h: 100, w: 100 })

  // Quelle: der Fernseher hat KEINE Sitzung und weist sich mit dem Geraeteschluessel aus,
  // die Admin-Vorschau (Editor/Wall) nutzt ihren Sitzungscookie.
  const path = playerKey
    ? `/player/icinga?key=${encodeURIComponent(playerKey)}${deviceKey ? `&k=${encodeURIComponent(deviceKey)}` : ''}`
    : '/icinga'
  const entry = useIcingaData(path, !!playerKey, still)
  const data = entry?.data
  const err = entry?.error

  // Wie viele Zeilen passen WIRKLICH in die Region? Da alles in cqmin bemessen ist,
  // genuegt dafuer das Seitenverhaeltnis: cqmin = min(Breite,Hoehe)/100 -> Hoehe in cqmin.
  // So wird nie eine Zeile halb abgeschnitten.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w <= 0 || h <= 0) return
      const cq = Math.min(w, h) / 100
      setSize((p) => (p.h === h / cq && p.w === w / cq ? p : { h: h / cq, w: w / cq }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Aussenhuelle: nur Positionierung und der schmale Kartenabstand. Sie ist bewusst
  // transparent — der Schatten der Karte braucht Platz, und die Region selbst schneidet
  // (overflow: hidden) alles ab, was ueber ihre Kante hinausragt.
  const shell: React.CSSProperties = {
    position: 'absolute', inset: 0, overflow: 'hidden',
    display: 'flex', padding: `${IC_CQ.edge}cqmin`, boxSizing: 'border-box',
  }
  // Die Karte selbst — Anmutung wie `Card` im CMS: feiner Rahmen, kleiner Radius,
  // dezenter Schatten. Farben stehen inline, damit die Kachel auf dem Fernseher immer
  // gleich aussieht, egal welches Theme der Admin gerade nutzt.
  const card: React.CSSProperties = {
    flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: `${IC_CQ.gap}cqmin`,
    padding: `${IC_CQ.pad}cqmin`, background: skin.bg, color: skin.txt,
    border: `max(1px, 0.12cqmin) solid ${skin.edge}`, borderRadius: '1.2cqmin',
    boxShadow: skin.shadow,
    fontFamily: IC_SANS, fontVariantNumeric: 'tabular-nums',
    // Grundschrift bewusst in Container-Einheiten: sonst erbt jede Zeile, die nur
    // Inline-Text enthaelt, die 16-px-Grundlinie des Browsers — und sprengt in kleinen
    // Regionen das berechnete Hoehenbudget.
    fontSize: '3cqmin', lineHeight: 1.2,
  }

  // Nur die ausfuehrlichen Bausteine haben Platz fuer die vollstaendige Servermeldung.
  // In eine Ampel oder Einzelzahl gehoert sie nicht — dort steht ein knapper Hinweis.
  const detailed = view === 'overview' || view === 'problems'

  let body: React.ReactNode
  if (!data && !err) {
    body = <IcingaLoading />
  } else if (err && (detailed || !data)) {
    body = <IcingaErrorPanel message={err} data={data} compact={!detailed} />
  } else if (data) {
    const stale = err ? entry?.dataAt : undefined
    switch (view) {
      case 'status': body = <IcingaStatusView data={data} stale={stale} />; break
      case 'count': body = <IcingaCountView data={data} metric={metric} stale={stale} />; break
      case 'services': body = <IcingaServicesView data={data} size={size} stale={stale} />; break
      case 'hosts': body = <IcingaHostsView data={data} size={size} stale={stale} />; break
      case 'problems': body = <IcingaProblemsView data={data} size={size} maxRows={maxRows} />; break
      case 'groups': body = <IcingaGroupsView data={data} size={size} />; break
      case 'recovered': body = <IcingaRecoveredView data={data} size={size} />; break
      case 'trend': body = <IcingaTrendView data={data} size={size} />; break
      case 'health': body = <IcingaHealthView data={data} />; break
      default: body = <IcingaOverview data={data} size={size} maxRows={maxRows} />
    }
  }

  return (
    <IcingaSkinCtx.Provider value={skin}>
      <IcingaStillCtx.Provider value={!!still}>
        <div ref={rootRef} style={shell}><div style={card}>{body}</div></div>
      </IcingaStillCtx.Provider>
    </IcingaSkinCtx.Provider>
  )
}

/** Ruhiger Zwischenzustand — Text statt Symbol, ohne Animation. */
function IcingaLoading() {
  const s = useSkin()
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1.6cqmin' }}>
      <div style={{ display: 'flex' }}><IcingaCap text="Monitoring" size="min(7cqh, 3cqw)" /></div>
      <div style={{ fontSize: 'min(11cqh, 4.6cqw)', color: s.dim }}>Status wird abgerufen…</div>
    </div>
  )
}

/** Fehlerzustand: rot getoentes Feld mit Kantenbalken (wie Icingas Hinweisboxen), Klartext. */
function IcingaErrorPanel({ message, data, compact }: { message: string; data?: IcingaSummary; compact?: boolean }) {
  const nowTick = useIcingaNow(data?.fetchedAt ?? Date.now())
  const s = useSkin()
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', gap: '2.4cqmin', overflow: 'hidden',
      background: s.st.critical.tint, border: `max(1px, 0.14cqmin) solid ${s.st.critical.edge}`,
      borderRadius: '0.8cqmin', paddingRight: '2.4cqmin',
    }}>
      <span aria-hidden="true" style={{ flex: 'none', width: '1cqmin', background: s.st.critical.fill }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1.6cqmin' }}>
        {/* Klein gesetzte Kachel: Wortmarke und Aussage getrennt, damit nichts abschneidet. */}
        {compact && <div style={{ display: 'flex' }}><IcingaCap text="Monitoring" size="min(7cqh, 2.8cqw)" /></div>}
        <div style={{ display: 'flex' }}>
          <IcingaCap text={compact ? 'Nicht verfügbar' : 'Monitoring nicht verfügbar'}
            size={compact ? 'min(13cqh, 5.2cqw)' : 'min(9cqh, 3.4cqw)'} color={s.st.critical.color} />
        </div>
        {compact ? (
          <div style={{ fontSize: 'min(9cqh, 3.4cqw)', color: s.dim }}>Grund in der Gesamtübersicht</div>
        ) : (
          <div style={{ fontSize: 'min(7cqh, 2.6cqw)', lineHeight: 1.4, color: s.txt }}>{message}</div>
        )}
        {data && (
          <div style={{ display: 'flex' }}>
            <IcingaCap size="min(6cqh, 2.3cqw)" text={`${icingaClock(nowTick)} · ${data.problems.length} offene Meldungen`} />
          </div>
        )}
      </div>
    </div>
  )
}

/** „Veraltet"-Marke: erscheint nur, wenn der letzte Abruf fehlschlug, aber alte Daten stehen. */
function IcingaStaleMark({ at }: { at?: number }) {
  const s = useSkin()
  if (!at) return null
  return (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: '1.2cqmin', borderTop: icHair(s), paddingTop: '1.2cqmin' }}>
      <IcingaDot state="warning" size="1.4cqmin" />
      <IcingaCap text={`veraltet · Stand ${icingaClock(at)}`} size="2.6cqmin" color={s.st.warning.color} />
    </div>
  )
}

/** Kopfzeile: Kantenbalken, Urteil, rechts die Herkunft. Traegt jeden grossen Baustein. */
function IcingaHeader({ state, word, right }: { state: IcingaState; word: string; right?: string }) {
  const s = useSkin()
  return (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: '1.6cqmin', height: `${IC_CQ.header}cqmin` }}>
      <span aria-hidden="true" style={{ flex: 'none', width: '1cqmin', height: '76%', borderRadius: '0.5cqmin', background: s.st[state].fill }} />
      <div style={{
        minWidth: 0, flex: 1, fontSize: '5cqmin', fontWeight: 700, letterSpacing: '0.02em',
        textTransform: 'uppercase', color: s.st[state].color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{word}</div>
      {right && <IcingaCap text={right} size="2.7cqmin" />}
    </div>
  )
}

const IC_WORD: Record<IcingaState, string> = { critical: 'Störung', warning: 'Warnung', unknown: 'Unklar', ok: 'Betrieb normal' }

// --- Baustein: Ampel -------------------------------------------------------
function IcingaStatusView({ data, stale }: { data: IcingaSummary; stale?: number }) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const s = useSkin()
  const worst = icingaWorst(data)
  const { services, hosts } = data
  const parts: string[] = []
  if (hosts.down) parts.push(`${hosts.down} Hosts aus`)
  if (services.critical) parts.push(`${services.critical} kritisch`)
  if (services.warning) parts.push(`${services.warning} Warnung`)
  if (services.unknown) parts.push(`${services.unknown} unbekannt`)
  if (data.staleChecks) parts.push(`${data.staleChecks} überfällig`)
  const ack = hosts.acknowledged + services.acknowledged
  const word = { critical: 'Störung', warning: 'Warnung', unknown: 'Unklar', ok: 'Normal' }[worst]
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', gap: '2.6cqmin' }}>
        <span aria-hidden="true" style={{ flex: 'none', width: '1.6cqmin', height: '100%', borderRadius: '0.8cqmin', background: s.st[worst].fill }} />
        {/* Zwei Grenzen: die Hoehe bestimmt die Groesse, die Breite deckelt sie —
            so fuellt das Urteil jede Region, ohne je ueber die Kante zu laufen. */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ ...IC_ELL, fontSize: 'min(28cqh, 12cqw)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '0.01em', textTransform: 'uppercase', color: s.st[worst].color }}>{word}</div>
          <div style={{ ...IC_ELL, fontSize: 'min(8cqh, 3.6cqw)', color: s.txt, marginTop: '1.4cqmin' }}>
            {parts.length ? parts.slice(0, 2).join(' · ') : `${data.totals.services} Dienste · ${data.totals.hosts} Hosts`}
          </div>
          <div style={{ ...IC_ELL, marginTop: '1cqmin' }}>
            <IcingaCap text={`${icingaClock(nowTick)}${ack ? ` · ${ack} ausgeblendet` : ''}`} size="min(6cqh, 2.7cqw)" />
          </div>
        </div>
      </div>
      <IcingaStaleMark at={stale} />
    </div>
  )
}

// --- Baustein: Einzelzahl --------------------------------------------------
function IcingaCountView({ data, metric, stale }: { data: IcingaSummary; metric: IcingaMetric; stale?: number }) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const m = icingaMetricValue(data, metric)
  const txt = m.capped ? `${m.value}+` : String(m.value)
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <IcingaStat label={m.label} value={txt} state={m.state} hot={m.hot} sub={icingaClock(nowTick)} scale={1.15} wrap />
      </div>
      <IcingaStaleMark at={stale} />
    </div>
  )
}

// --- Bausteine: Dienste / Hosts -------------------------------------------
function IcingaServicesView({ data, size, stale }: { data: IcingaSummary; size: { w: number; h: number }; stale?: number }) {
  const s = data.services
  const items = [
    { label: 'Kritisch', value: String(s.critical), state: 'critical' as const, hot: true },
    { label: 'Warnung', value: String(s.warning), state: 'warning' as const, hot: true },
    { label: 'Unbekannt', value: String(s.unknown), state: 'unknown' as const, hot: true },
    { label: 'In Ordnung', value: String(s.ok), state: 'ok' as const, sub: `von ${data.totals.services}` },
  ]
  const portrait = size.h >= size.w * 1.25
  return (
    <>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2cqmin' }}>
        <IcingaCap text="Dienste" size="2.9cqmin" />
        <IcingaCap text={`${s.acknowledged} ausgeblendet · ${s.inDowntime} Wartung`} size="2.7cqmin" />
      </div>
      <IcingaStatGrid items={items} cols={portrait ? 2 : 4} rows={portrait ? 2 : 1} />
      <IcingaStaleMark at={stale} />
    </>
  )
}

function IcingaHostsView({ data, size, stale }: { data: IcingaSummary; size: { w: number; h: number }; stale?: number }) {
  const h = data.hosts
  const items = [
    { label: 'Ausgefallen', value: String(h.down), state: 'critical' as const, hot: true },
    { label: 'Unerreichbar', value: String(h.unreachable), state: 'unknown' as const, hot: true },
    { label: 'Erreichbar', value: String(h.up), state: 'ok' as const, sub: `von ${data.totals.hosts}` },
  ]
  const portrait = size.h >= size.w * 1.25
  return (
    <>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2cqmin' }}>
        <IcingaCap text="Hosts" size="2.9cqmin" />
        <IcingaCap text={`${h.acknowledged} ausgeblendet · ${h.inDowntime} Wartung`} size="2.7cqmin" />
      </div>
      <IcingaStatGrid items={items} cols={portrait ? 1 : 3} rows={portrait ? 3 : 1} />
      <IcingaStaleMark at={stale} />
    </>
  )
}

// --- Baustein: Icinga-Zustand ----------------------------------------------
function IcingaHealthView({ data }: { data: IcingaSummary }) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const s = useSkin()
  const h = data.icinga
  // Kurze Laufzeit heisst: Icinga wurde neu gestartet, moeglicherweise unbemerkt.
  const freshRestart = !!h && h.uptimeSeconds > 0 && h.uptimeSeconds < 3600
  const rows: { label: string; value: string; color?: string }[] = h ? [
    { label: 'Prüfungen/min', value: String(h.checksPerMinute) },
    { label: 'Latenz', value: icingaSeconds(h.latency) },
    { label: 'Ausführungszeit', value: icingaSeconds(h.executionTime) },
    { label: 'Laufzeit', value: icingaUptime(h.uptimeSeconds), color: freshRestart ? s.st.warning.color : undefined },
    { label: 'Überfällige Prüfungen', value: String(data.staleChecks), color: data.staleChecks > 0 ? s.st.critical.color : undefined },
    { label: 'Version', value: h.version || '—' },
  ] : [
    { label: 'Eigenzustand', value: 'nicht abfragbar', color: s.st.warning.color },
    { label: 'Überfällige Prüfungen', value: String(data.staleChecks), color: data.staleChecks > 0 ? s.st.critical.color : undefined },
    { label: 'Hosts', value: String(data.totals.hosts) },
    { label: 'Dienste', value: String(data.totals.services) },
  ]
  return (
    <>
      <IcingaHeader state={data.staleChecks > 0 || freshRestart ? 'warning' : 'ok'} word={h?.nodeName || 'Icinga'}
        right={icingaClock(nowTick)} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          // Jede Zeile ist ihr eigener Groessen-Container: die Schrift folgt der Zeilenhoehe,
          // dadurch fuellt die Tafel jede Region ohne Ueberlauf.
          <div key={r.label} style={{ flex: 1, minHeight: 0, containerType: 'size', borderTop: i === 0 ? undefined : icHair(s) }}>
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: '3cqw' }}>
              <span style={{ flex: 1, minWidth: 0 }}><IcingaCap text={r.label} size="min(30cqh, 5cqw)" /></span>
              <span style={{
                flex: 'none', fontFamily: IC_MONO, fontSize: 'min(46cqh, 9cqw)', fontWeight: 600,
                color: r.color ?? s.txt, whiteSpace: 'nowrap',
              }}>{r.value}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// --- Verlauf ---------------------------------------------------------------
/**
 * Der Verlauf wird auf eine feste Zahl Saeulen verdichtet (Maximum je Abschnitt —
 * eine Spitze darf nicht wegmitteln). Bewusst KEIN SVG: Saeulen aus Flaechen
 * skalieren mit den Container-Einheiten mit, eine SVG-Linie mit fester Strichstaerke
 * dagegen nicht — auf dem hochskalierten Fernseher waere sie ein Haarstrich.
 */
interface IcingaBucket { problems: number; critical: number; warning: number; down: number; t: number }

function icingaBuckets(history: IcingaSummary['history'], n: number): IcingaBucket[] {
  const len = history.length
  if (len === 0 || n <= 0) return []
  const count = Math.min(n, len)
  const out: IcingaBucket[] = []
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * len) / count)
    const to = Math.max(Math.floor(((i + 1) * len) / count), from + 1)
    const b: IcingaBucket = { problems: 0, critical: 0, warning: 0, down: 0, t: history[from]?.t ?? 0 }
    for (let j = from; j < to && j < len; j++) {
      const x = history[j]
      if (!x) continue
      b.problems = Math.max(b.problems, x.problems)
      b.critical = Math.max(b.critical, x.critical)
      b.warning = Math.max(b.warning, x.warning)
      b.down = Math.max(b.down, x.down)
      b.t = x.t
    }
    out.push(b)
  }
  return out
}

/** Der schwerste Zustand eines Abschnitts — faerbt die Saeule. */
function icingaBucketState(b: IcingaBucket): IcingaState | null {
  if (b.down > 0 || b.critical > 0) return 'critical'
  if (b.warning > 0) return 'warning'
  if (b.problems > 0) return 'unknown'
  return null
}

/** Ab so vielen Messpunkten lohnt eine Kurve — darunter waere sie irrefuehrend. */
const IC_SPARK_MIN = 6

function IcingaSparkBars({ buckets, max }: { buckets: IcingaBucket[]; max: number }) {
  const s = useSkin()
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'flex-end', gap: '0.25cqmin' }}>
      {buckets.map((b, i) => {
        const st = icingaBucketState(b)
        // Ruhige Abschnitte bekommen einen flachen Sockel in der Linienfarbe: so entsteht
        // eine durchgehende Grundlinie („durchweg ruhig") statt einer leeren Flaeche.
        const h = st ? Math.max(10, Math.round((b.problems / max) * 100)) : 0
        return (
          <span key={i} aria-hidden="true" style={{
            flex: 1, minWidth: 0, height: st ? `${h}%` : 'max(1px, 0.45cqmin)',
            background: st ? s.st[st].fill : s.line, borderRadius: '0.25cqmin 0.25cqmin 0 0',
          }} />
        )
      })}
    </div>
  )
}

/** Hinweis statt Kurve, solange zu wenige Messpunkte vorliegen — ehrlich benannt. */
function IcingaSparkPending({ count, size = '2.6cqmin' }: { count: number; size?: string }) {
  const s = useSkin()
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <IcingaCap text={count === 0 ? 'Noch keine Aufzeichnung' : 'Aufzeichnung laeuft — die Kurve erscheint in wenigen Minuten'} size={size} color={s.dim} />
    </div>
  )
}

/** Verlaufsstreifen fuer die Gesamtuebersicht: Beschriftung, Saeulen, Zeitachse. */
function IcingaTrendStrip({ data, height }: { data: IcingaSummary; height: number }) {
  const s = useSkin()
  const h = data.history
  const buckets = icingaBuckets(h, 46)
  const max = Math.max(1, ...buckets.map((b) => b.problems))
  const span = h.length >= 2 ? icingaAge(h[h.length - 1].t - h[0].t) : ''
  return (
    <div style={{ flex: 'none', height: `${height}cqmin`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.6cqmin' }}>
        <IcingaCap text="Verlauf" size="2.6cqmin" color={s.dim} />
        <IcingaCap text={h.length >= IC_SPARK_MIN ? `Spitze ${max}` : ''} size="2.6cqmin" />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', paddingTop: '0.8cqmin', borderBottom: icHair(s) }}>
        {h.length >= IC_SPARK_MIN ? <IcingaSparkBars buckets={buckets} max={max} /> : <IcingaSparkPending count={h.length} />}
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.6cqmin', paddingTop: '0.5cqmin' }}>
        <IcingaCap text={span ? `vor ${span}` : 'Aufzeichnung läuft'} size="2.4cqmin" />
        <IcingaCap text="jetzt" size="2.4cqmin" />
      </div>
    </div>
  )
}

// --- Baustein: Verlauf -----------------------------------------------------
function IcingaTrendView({ data, size }: { data: IcingaSummary; size: { w: number; h: number } }) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const s = useSkin()
  const h = data.history
  // Auf breiten Regionen mehr Saeulen — eine Saeule sollte nicht zum Balken werden.
  const buckets = icingaBuckets(h, Math.max(24, Math.min(96, Math.round(size.w * 0.55))))
  const max = Math.max(1, ...buckets.map((b) => b.problems))
  const now = h.length ? h[h.length - 1].problems : data.problems.length
  const span = h.length >= 2 ? icingaAge(h[h.length - 1].t - h[0].t) : ''
  const first = h.length ? h[0].problems : 0
  const delta = now - first
  const worst = icingaSeverity(data.problems)
  // Richtung in Worten, nicht als Pfeil-Piktogramm.
  // Richtung in Worten, nicht als Pfeil-Piktogramm. Bei durchgehend null waere
  // "unverändert" irrefuehrend - dann ist die Aussage "es gab gar nichts".
  const allZero = h.length > 0 && max === 0
  const trendWord = h.length < IC_SPARK_MIN ? 'Aufzeichnung läuft'
    : allZero ? `durchgehend ohne Meldungen${span ? ` (${span})` : ''}`
    : delta > 0 ? `${delta} mehr als vor ${span}`
    : delta < 0 ? `${-delta} weniger als vor ${span}`
    : `unverändert seit ${span}`
  return (
    <>
      <IcingaHeader state={worst} word="Offene Meldungen im Verlauf"
        right={span ? `letzte ${span} · ${icingaClock(nowTick)}` : icingaClock(nowTick)} />
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: '3cqmin', overflow: 'hidden' }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '1.2cqmin', flex: 'none' }}>
          <IcingaCap text="jetzt" size="2.7cqmin" />
          <span style={{ fontFamily: IC_MONO, fontSize: '4.6cqmin', fontWeight: 600, color: now ? s.st[worst].color : s.txt }}>{now}</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '1.2cqmin', flex: 'none' }}>
          <IcingaCap text="Spitze" size="2.7cqmin" />
          <span style={{ fontFamily: IC_MONO, fontSize: '4.6cqmin', fontWeight: 600, color: s.txt }}>{max}</span>
        </span>
        <span style={{ flex: 1 }} />
        <IcingaCap text={trendWord} size="2.7cqmin" color={s.dim} />
      </div>
      {/* Obere Kante = Spitze, untere Kante = Null: zwei Linien genuegen als Achse. */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.6cqmin' }}>
        <IcingaCap text="offene Meldungen" size="2.5cqmin" />
        <IcingaCap text={String(max)} size="2.5cqmin" />
      </div>
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', paddingTop: '0.8cqmin',
        borderTop: icHair(s), borderBottom: icHair(s),
      }}>
        {h.length >= IC_SPARK_MIN ? <IcingaSparkBars buckets={buckets} max={max} /> : <IcingaSparkPending count={h.length} size="3.2cqmin" />}
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.6cqmin' }}>
        <IcingaCap text={span ? `vor ${span}` : 'seit Beginn der Aufzeichnung'} size="2.5cqmin" />
        <IcingaCap text="jetzt" size="2.5cqmin" />
      </div>
    </>
  )
}

// --- Gruppen ---------------------------------------------------------------
/** Schwerster offener Zustand einer Gruppe (bestaetigte Meldungen zaehlt der Server nicht mit). */
function icingaGroupState(g: IcingaGroup): IcingaState | null {
  if (g.down > 0 || g.critical > 0) return 'critical'
  if (g.warning > 0) return 'warning'
  return null
}

/**
 * Fuellbalken einer Gruppe: gesunder Anteil und Problemanteile als Segmente.
 * Der Balken ist eine MENGENANGABE, kein Urteil — deshalb traegt auch der gesunde
 * Anteil Farbe, waehrend die Zahl daneben neutral bleibt, solange nichts offen ist.
 */
function IcingaGroupBar({ g }: { g: IcingaGroup }) {
  const s = useSkin()
  const total = Math.max(1, g.total)
  const bad = Math.min(total, g.down + g.critical)
  const warn = Math.min(total - bad, g.warning)
  const ok = Math.max(0, Math.min(total - bad - warn, g.ok))
  const seg = (n: number, color: string) => (n > 0 ? <span style={{ width: `${(n / total) * 100}%`, background: color }} /> : null)
  return (
    <span aria-hidden="true" style={{
      flex: 'none', width: '100%', height: '100%', display: 'flex', overflow: 'hidden',
      background: s.track, borderRadius: '0.6cqh',
    }}>
      {seg(bad, s.st.critical.fill)}
      {seg(warn, s.st.warning.fill)}
      {seg(ok, s.st.ok.fill)}
    </span>
  )
}

/**
 * Eine Zeile der Gruppen-Gesundheit. Jede Zeile ist ihr eigener Groessen-Container:
 * die Schrift folgt der Zeilenhoehe, dadurch fuellt die Liste jede Region ohne Ueberlauf.
 */
function IcingaGroupRow({ g, wide, maxH }: { g: IcingaGroup; wide: boolean; maxH: number }) {
  const s = useSkin()
  const sev = icingaGroupState(g)
  const num: React.CSSProperties = {
    flex: 'none', width: '9%', textAlign: 'right', fontFamily: IC_MONO,
    fontSize: 'min(34cqh, 4.4cqw)', fontWeight: 600,
  }
  return (
    <div style={{ flex: 1, minHeight: 0, maxHeight: `${maxH}cqmin`, containerType: 'size', overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: '2cqw' }}>
        <span aria-hidden="true" style={{
          flex: 'none', width: 'min(1.2cqw, 2.6cqh)', height: '100%',
          background: sev ? s.st[sev].fill : s.line,
        }} />
        <span style={{
          ...IC_ELL, flex: 1, minWidth: 0, fontSize: 'min(34cqh, 4.4cqw)', color: s.txt, paddingLeft: '1cqw',
        }}>{g.name}</span>
        <span style={{ flex: 'none', width: wide ? '19%' : '22%', height: 'min(24cqh, 3cqw)', display: 'flex' }}><IcingaGroupBar g={g} /></span>
        <span style={{
          flex: 'none', width: wide ? '15%' : '17%', textAlign: 'right', fontFamily: IC_MONO,
          fontSize: 'min(32cqh, 4cqw)', fontWeight: 600, color: sev ? s.st[sev].color : s.mute,
        }}>{g.ok}/{g.total}</span>
        {wide && <span style={{ ...num, color: g.down ? s.st.critical.color : s.mute }}>{g.down}</span>}
        {wide && <span style={{ ...num, color: g.critical ? s.st.critical.color : s.mute }}>{g.critical}</span>}
        {wide && <span style={{ ...num, color: g.warning ? s.st.warning.color : s.mute }}>{g.warning}</span>}
      </div>
    </div>
  )
}

// --- Baustein: Gruppen -----------------------------------------------------
function IcingaGroupsView({ data, size }: { data: IcingaSummary; size: { w: number; h: number } }) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const s = useSkin()
  const bad = data.groups.filter((g) => icingaGroupState(g) !== null)
  const avail = Math.max(0, size.h - (IC_CQ.edge * 2 + IC_CQ.pad * 2 + IC_CQ.header + IC_CQ.gap + IC_CQ.section + IC_CQ.gap))
  // Nur so viele Zeilen, wie bei lesbarer Mindesthoehe hineinpassen — die verbleibende
  // Flaeche teilen sie sich zu gleichen Teilen, damit die Tafel nicht halbleer wirkt.
  const fitAll = icFit(avail, IC_CQ.grpRow)
  const hasMore = data.groups.length > fitAll
  const fit = hasMore ? icFit(avail, IC_CQ.grpRow, IC_CQ.more) : fitAll
  const rows = data.groups.slice(0, Math.max(1, fit))
  const hidden = data.groups.length - rows.length
  // Die drei Zahlenspalten brauchen Breite; in schmalen Regionen tragen Balken und
  // „ok/gesamt" die Aussage allein, statt dass alles auf „…" endet.
  const wide = size.w >= 145
  const numCell: React.CSSProperties = { flex: 'none', width: '9%', textAlign: 'right' }
  return (
    <>
      <IcingaHeader state={bad.some((g) => g.down || g.critical) ? 'critical' : bad.length ? 'warning' : 'ok'}
        word={`${data.groups.length} ${data.groups.length === 1 ? 'Gruppe' : 'Gruppen'}`}
        right={`${bad.length ? `${bad.length} betroffen` : 'alle unauffällig'} · ${icingaClock(nowTick)}`} />
      {/* Spaltenkopf: die Zahlenspalten sind fest, damit die Position mitspricht. */}
      <div style={{
        flex: 'none', display: 'flex', alignItems: 'center', gap: '2cqmin',
        height: `${IC_CQ.section}cqmin`, borderBottom: icHair(s),
      }}>
        <span style={{ flex: 1, minWidth: 0, paddingLeft: '2.4cqmin' }}><IcingaCap text="Gruppe" size="2.6cqmin" /></span>
        <span style={{ flex: 'none', width: wide ? '19%' : '22%' }}><IcingaCap text="Gesund" size="2.6cqmin" /></span>
        <span style={{ flex: 'none', width: wide ? '15%' : '17%', textAlign: 'right', display: 'flex', justifyContent: 'flex-end' }}><IcingaCap text="OK" size="2.6cqmin" /></span>
        {wide && <span style={{ ...numCell, display: 'flex', justifyContent: 'flex-end' }}><IcingaCap text="Aus" size="2.6cqmin" /></span>}
        {wide && <span style={{ ...numCell, display: 'flex', justifyContent: 'flex-end' }}><IcingaCap text="Krit" size="2.6cqmin" /></span>}
        {wide && <span style={{ ...numCell, display: 'flex', justifyContent: 'flex-end' }}><IcingaCap text="Warn" size="2.6cqmin" /></span>}
      </div>
      {data.groups.length === 0 ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1.4cqmin' }}>
          <div style={{ fontSize: '5cqmin', fontWeight: 600, color: s.txt }}>Keine Gruppen definiert</div>
          <IcingaCap text={`${data.totals.hosts} Hosts · ${data.totals.services} Dienste überwacht`} size="2.9cqmin" />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: `${IC_CQ.rowGap}cqmin`, overflow: 'hidden' }}>
          {rows.map((g) => <IcingaGroupRow key={g.name} g={g} wide={wide} maxH={IC_CQ.grpRow * 2.2} />)}
          {hidden > 0 && (
            <div style={{ flex: 'none', paddingTop: '0.4cqmin' }}>
              <IcingaCap text={`+ ${hidden} weitere ${hidden === 1 ? 'Gruppe' : 'Gruppen'}`} size="2.7cqmin" />
            </div>
          )}
        </div>
      )}
    </>
  )
}

// --- Baustein: Zuletzt erholt ----------------------------------------------
/**
 * Eine Zeile fuer „zuletzt erholt" bzw. „bestaetigt": neutrale Flaeche mit
 * Kantenbalken. Bewusst NICHT flaechig getoent — das bleibt den offenen Meldungen
 * vorbehalten, damit der Blick nicht auf Erledigtes faellt.
 */
function IcingaSideRow(
  { kind, host, service, right, state, badge, height }:
  { kind: 'host' | 'service'; host: string; service: string; right: string; state: IcingaState; badge?: string; height: number },
) {
  const s = useSkin()
  return (
    <div style={{
      flex: 'none', height: `${height}cqmin`, display: 'flex', alignItems: 'center', gap: '1.4cqmin',
      background: s.row, boxShadow: `inset 0 0 0 max(1px, 0.1cqmin) ${s.edge}`,
      borderRadius: '0.6cqmin', paddingRight: '1.4cqmin', overflow: 'hidden',
    }}>
      <span aria-hidden="true" style={{ flex: 'none', width: '0.8cqmin', height: '100%', background: s.st[state].fill }} />
      <span style={{ flex: 'none', width: 'max(8%, 12cqmin)', display: 'flex', overflow: 'hidden', paddingLeft: '0.6cqmin' }}>
        <IcingaCap text={kind === 'host' ? 'Host' : 'Dienst'} size="2.4cqmin" />
      </span>
      <span style={{ ...IC_ELL, flexShrink: 0, maxWidth: '42%', fontFamily: IC_MONO, fontSize: '3.2cqmin', fontWeight: 600, color: s.txt }}>{host}</span>
      <span style={{ ...IC_ELL, flex: '1 1 auto', minWidth: 0, fontSize: '3.1cqmin', color: s.dim }}>{service}</span>
      {badge && (
        <span style={{
          flex: 'none', fontSize: '2.7cqmin', fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: s.st[state].color,
        }}>{badge}</span>
      )}
      <span style={{
        flex: 'none', textAlign: 'right', fontFamily: IC_MONO, fontSize: '2.9cqmin', color: s.dim,
        whiteSpace: 'nowrap',
      }}>{right}</span>
    </div>
  )
}

function IcingaRecoveredView({ data, size }: { data: IcingaSummary; size: { w: number; h: number } }) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const s = useSkin()
  const list = data.recovered
  const avail = Math.max(0, size.h - (IC_CQ.edge * 2 + IC_CQ.pad * 2 + IC_CQ.header + IC_CQ.gap))
  const fitAll = icFit(avail, IC_CQ.side)
  const fit = list.length > fitAll ? icFit(avail, IC_CQ.side, IC_CQ.more) : fitAll
  const rows = list.slice(0, Math.max(1, fit))
  const hidden = list.length - rows.length
  // Sind es nur wenige Erholungen, bleibt sonst eine leere Flaeche stehen. Statt dessen
  // beantwortet ein Zahlenband darunter die naechstliegende Frage: und sonst so?
  const leftover = avail - rows.length * (IC_CQ.side + IC_CQ.rowGap) - (hidden > 0 ? IC_CQ.more : 0)
  const withStats = list.length > 0 && leftover >= 22
  return (
    <>
      <IcingaHeader state="ok" word={list.length ? `${list.length} ${list.length === 1 ? 'Erholung' : 'Erholungen'}` : 'Keine Erholung'}
        right={`letzte Stunde · ${icingaClock(nowTick)}`} />
      {list.length === 0 ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1.4cqmin' }}>
          <div style={{ fontSize: '5cqmin', fontWeight: 600, color: s.txt }}>Nichts hat sich in der letzten Stunde gefangen</div>
          <IcingaCap text={`${data.problems.length} offen · ${data.services.ok} Dienste in Ordnung · ${data.hosts.up} Hosts erreichbar${data.settling ? ` · ${data.settling} wird beobachtet` : ''}`} size="2.9cqmin" />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: `${IC_CQ.rowGap}cqmin`, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <IcingaSideRow key={`${r.host}|${r.service}|${i}`} kind={r.kind} host={r.host} service={[r.label || r.service || 'Host wieder erreichbar', r.output].filter(Boolean).join('  ·  ')}
              right={`vor ${icingaAge(nowTick - r.at)}`} state="ok" height={IC_CQ.side} />
          ))}
          {hidden > 0 && (
            <div style={{ flex: 'none', paddingTop: '0.4cqmin' }}>
              <IcingaCap text={`+ ${hidden} weitere`} size="2.7cqmin" />
            </div>
          )}
          <span style={{ flex: 1, minHeight: 0 }} />
          {withStats && (
            <div style={{
              flex: 'none', height: `${Math.min(24, leftover - 2)}cqmin`, display: 'flex', overflow: 'hidden',
              background: s.panel, borderRadius: '0.8cqmin', boxShadow: `inset 0 0 0 max(1px, 0.12cqmin) ${s.edge}`,
            }}>
              <IcingaStatGrid cols={3} rows={1} items={[
                { label: 'Erholt', value: String(list.length), sub: 'letzte Stunde', state: 'ok' },
                { label: 'Offen', value: String(data.problems.length), sub: 'Meldungen', state: icingaSeverity(data.problems), hot: true },
                { label: 'Dienste ok', value: String(data.services.ok), sub: `von ${data.totals.services}` },
              ]} />
            </div>
          )}
        </div>
      )}
    </>
  )
}

// --- Baustein: Problemliste ------------------------------------------------
function IcingaProblemsView({ data, size, maxRows }: { data: IcingaSummary; size: { w: number; h: number }; maxRows: number }) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const p = data.problems
  const ack = data.hosts.acknowledged + data.services.acknowledged
  return (
    <>
      <IcingaHeader state={icingaSeverity(p)} word={`${p.length} offene ${p.length === 1 ? 'Meldung' : 'Meldungen'}`}
        right={`${ack} ausgeblendet · ${icingaClock(nowTick)}`} />
      <IcingaProblemList data={data} avail={Math.max(0, size.h - (IC_CQ.edge * 2 + IC_CQ.pad * 2 + IC_CQ.header + IC_CQ.gap))}
        maxRows={maxRows} calmGroups />
    </>
  )
}

/** Die Liste selbst — von „Problemliste" UND „Gesamtuebersicht" benutzt. */
function IcingaProblemList(
  { data, avail, maxRows, calmGroups }:
  { data: IcingaSummary; avail: number; maxRows: number; calmGroups?: boolean },
) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const { problems } = data
  // Ruhezustand: NICHT leer lassen. Was sonst nie zu sehen ist, kommt jetzt zum Vorschein —
  // zuletzt Erholtes, Bestaetigtes, auf Wunsch die Gruppen-Gesundheit.
  if (problems.length === 0) return <IcingaCalmPanel data={data} avail={avail} withGroups={calmGroups} />
  // Platzbudget -> Zeilenanzahl. Passen nicht genug ausfuehrliche Zeilen, wird auf die
  // kompakte Einzeilen-Darstellung umgeschaltet, statt Zeilen abzuschneiden.
  const fitFor = (row: number, extra: number) => icFit(avail, row, extra)
  const want = Math.min(maxRows, problems.length)
  // Die Schlusszeile „+ N weitere Meldungen" kostet Platz und muss VORHER abgezogen werden.
  // Sie erscheint, sobald nicht alle Meldungen gezeigt werden — das kann am Platz liegen
  // ODER an der eingestellten Obergrenze. Nur den Platz zu pruefen reichte nicht: bei
  // „hoechstens 6" und 8 offenen Meldungen passten die Zeilen, die Schlusszeile aber nicht
  // mehr — sie wurde dann halb unter der Fusszeile abgeschnitten.
  const needMore = (row: number) => problems.length > Math.min(want, fitFor(row, 0))
  const fitA = fitFor(IC_CQ.rowA, needMore(IC_CQ.rowA) ? IC_CQ.more : 0)
  const compact = want > fitA
  const rowCq = compact ? IC_CQ.rowB : IC_CQ.rowA
  const fit = compact ? fitFor(IC_CQ.rowB, needMore(IC_CQ.rowB) ? IC_CQ.more : 0) : fitA
  const rows = problems.slice(0, Math.max(1, Math.min(want, fit)))
  const hidden = problems.length - rows.length
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: `${IC_CQ.rowGap}cqmin`, overflow: 'hidden' }}>
      {rows.map((p, i) => <IcingaRow key={`${p.host}|${p.service}|${i}`} p={p} now={nowTick} compact={compact} height={rowCq} />)}
      {hidden > 0 && (
        <div style={{ flex: 'none', paddingTop: '0.6cqmin' }}>
          <IcingaCap text={`+ ${hidden} weitere ${hidden === 1 ? 'Meldung' : 'Meldungen'}`} size="2.7cqmin" />
        </div>
      )}
    </div>
  )
}

/**
 * Eine Meldezeile: schmaler Kantenbalken, Art (HOST/DIENST), Objekt, Kurzwort, Dauer.
 * Die Spalten stehen fest — die Position sagt mit, was der Wert bedeutet.
 */
function IcingaRow({ p, now, compact, height }: { p: IcingaProblem; now: number; compact: boolean; height: number }) {
  const s = useSkin()
  const meta = IC_PROBLEM[p.state] ?? { sev: 'unknown' as IcingaState, short: p.state.toUpperCase() }
  const c = s.st[meta.sev]
  const age = p.since > 0 ? icingaAge(now - p.since) : '—'
  const kind = p.kind === 'host' ? 'Host' : 'Dienst'
  // Flaechig getoente Zeile wie in den Listen von Icinga Web 2: helle Statusfarbe als
  // Hintergrund, kontrastgeprueftes Wort darauf, kraeftiger Kantenbalken in der reinen
  // Statusfarbe. Der Ring liegt als Inset-Schatten an, damit die Kante die Zeilenhoehe
  // nicht veraendert.
  const shell: React.CSSProperties = {
    flex: 'none', height: `${height}cqmin`, display: 'flex', alignItems: 'center', gap: '1.6cqmin',
    background: c.tint, boxShadow: `inset 0 0 0 max(1px, 0.1cqmin) ${c.edge}`,
    borderRadius: '0.6cqmin', paddingRight: '1.6cqmin', overflow: 'hidden',
  }
  const bar = <span aria-hidden="true" style={{ flex: 'none', width: '1cqmin', height: '100%', background: c.fill }} />
  // Feste Spalten, aber mit einer Untergrenze in cqmin: die Prozentbreite richtet sich
  // nach der REGIONSBREITE, die Schrift nach cqmin = min(Breite,Hoehe). In einer breiten,
  // flachen Region passt das; in einer eher quadratischen lief „UNERR" sonst in die
  // Nachbarspalte. Die Untergrenze deckt das laengste Kurzwort ab.
  const short = (
    <span style={{
      flex: 'none', width: 'max(7.5%, 13cqmin)', textAlign: 'right', fontSize: compact ? '2.9cqmin' : '3cqmin',
      fontWeight: 700, letterSpacing: '0.08em', color: c.color,
    }}>{meta.short}</span>
  )
  const when = (
    <span style={{
      flex: 'none', width: '13%', textAlign: 'right', fontFamily: IC_MONO,
      fontSize: compact ? '2.9cqmin' : '3.1cqmin', color: s.dim,
    }}>{age}</span>
  )
  if (compact) {
    return (
      <div style={shell}>
        {bar}
        <span style={{ flex: 'none', width: 'max(8%, 12.5cqmin)', display: 'flex', overflow: 'hidden', paddingLeft: '0.6cqmin' }}>
          <IcingaCap text={kind} size="2.5cqmin" />
        </span>
        <span style={{ ...IC_ELL, flexShrink: 0, maxWidth: '42%', fontFamily: IC_MONO, fontSize: '3.4cqmin', fontWeight: 600, color: s.txt }}>{p.host}</span>
        <span style={{ ...IC_ELL, flex: '1 1 auto', minWidth: 0, fontSize: '3.3cqmin', color: s.dim }}>
          {p.label || p.service}{p.output ? <span style={{ color: c.color, fontWeight: 600 }}>{`  ${p.output}`}</span> : null}
        </span>
        {short}
        {when}
      </div>
    )
  }
  return (
    <div style={shell}>
      {bar}
      <div style={{ minWidth: 0, flex: 1, paddingLeft: '0.6cqmin' }}>
        <div style={{ ...IC_ELL, display: 'flex', alignItems: 'baseline', gap: '1.2cqmin' }}>
          <IcingaCap text={kind} size="2.5cqmin" />
          <span style={{ ...IC_ELL, fontFamily: IC_MONO, fontSize: '3.9cqmin', fontWeight: 600, color: s.txt }}>{p.host}</span>
        </div>
        {/* Zweite Zeile: WAS geprueft wird + WAS gemessen wurde. Der reine Pruefname
            ("CPU-Auslastung") sagt nicht, was los ist - der Messwert schon ("82,3 %"). */}
        <div style={{ ...IC_ELL, fontSize: '3.2cqmin', color: s.dim, marginTop: '0.4cqmin' }}>
          {p.label || p.service || '—'}
          {p.output ? <span style={{ color: c.color, fontWeight: 600 }}>{`  ·  ${p.output}`}</span> : null}
        </div>
      </div>
      {short}
      {when}
    </div>
  )
}

// --- Ruhezustand -----------------------------------------------------------
/**
 * Der Ruhezustand ist der Normalfall und darf trotzdem nicht kahl wirken: statt einer
 * leeren Flaeche stehen hier die Dinge, die es sonst nie auf den Schirm schaffen -
 * zuletzt Erholtes, woran schon jemand arbeitet, Gesundheit je Gruppe.
 */
function IcingaCalmPanel(
  { data, avail, withGroups }:
  { data: IcingaSummary; avail: number; withGroups?: boolean },
) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const s = useSkin()
  const ack = data.acknowledged
  const rec = data.recovered
  const ackCount = data.hosts.acknowledged + data.services.acknowledged
  // Kopf: nuechterne Entwarnung mit Zahlen — nie nur ein Wort.
  const head = 11.5

  // Wie lange ist schon Ruhe? Der Verlauf weiss es, solange er zurueckreicht.
  // Gemessen wird gegen JETZT, nicht gegen den letzten Messpunkt: die Punkte kommen nur
  // alle 30 s, dagegen gerechnet sprang die Anzeige in 30-Sekunden-Stufen und hinkte nach.
  const quietSince = (() => {
    const h = data.history
    if (h.length < 2) return ''
    for (let i = h.length - 1; i >= 0; i--) if (h[i].problems > 0) {
      return i === h.length - 1 ? '' : `ruhig seit ${icingaAge(nowTick - h[i].t)}`
    }
    return `durchgehend ruhig seit ${icingaAge(nowTick - h[0].t)}`
  })()

  // Platz aufteilen. „Zuletzt erholt" bekommt den Vorrang (es zeigt Bewegung),
  // „Bestaetigt" bleibt knapp — aber nie ganz weg, solange eine Zeile hineinpasst.
  // Solange das Budget nicht reicht, wird der jeweils groessere Block gekuerzt.
  const block = (n: number, row: number) => (n > 0 ? IC_CQ.section + n * (row + IC_CQ.rowGap) + IC_CQ.gap : 0)
  const budget = Math.max(0, avail - head)
  let recRows = Math.min(rec.length, 4)
  let ackRows = Math.min(ack.length, 2)
  while (recRows + ackRows > 0 && block(recRows, IC_CQ.side) + block(ackRows, IC_CQ.side) > budget) {
    if (ackRows >= recRows) ackRows--
    else recRows--
  }
  const rest = Math.max(0, budget - block(recRows, IC_CQ.side) - block(ackRows, IC_CQ.side))
  const grpFit = withGroups && data.groups.length ? icFit(Math.max(0, rest - IC_CQ.section - IC_CQ.gap), IC_CQ.grpRow) : 0
  // Eine einzelne Gruppenzeile unter einer Ueberschrift sieht nach Abbruch aus —
  // dann bleibt die Flaeche lieber frei.
  const grpRows = Math.min(data.groups.length, grpFit) >= 2 ? Math.min(data.groups.length, grpFit) : 0

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: `${IC_CQ.gap}cqmin`, overflow: 'hidden' }}>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: '1.2cqmin' }}>
        <div style={{ ...IC_ELL, fontSize: '5.2cqmin', fontWeight: 600, color: s.txt }}>Keine offenen Meldungen</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2.4cqmin', overflow: 'hidden' }}>
          <span style={{ minWidth: 0, display: 'flex' }}>
            <IcingaCap size="2.9cqmin" text={`${data.services.ok}/${data.totals.services} Dienste · ${data.hosts.up}/${data.totals.hosts} Hosts`} />
          </span>
          {quietSince && <span style={{ flex: 'none', display: 'flex' }}><IcingaCap size="2.9cqmin" text={quietSince} color={s.st.ok.color} /></span>}
        </div>
      </div>

      {recRows > 0 && (
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: `${IC_CQ.rowGap}cqmin` }}>
          <IcingaSection title="Zuletzt erholt" right={`${rec.length} in der letzten Stunde`} />
          {rec.slice(0, recRows).map((r, i) => (
            <IcingaSideRow key={`${r.host}|${r.service}|${i}`} kind={r.kind} host={r.host} service={[r.label || r.service || 'Host wieder erreichbar', r.output].filter(Boolean).join('  ·  ')}
              right={`vor ${icingaAge(nowTick - r.at)}`} state="ok" height={IC_CQ.side} />
          ))}
        </div>
      )}

      {ackRows > 0 && (
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: `${IC_CQ.rowGap}cqmin` }}>
          <IcingaSection title="Ausgeblendet" right={`${ackCount} gesamt`} />
          {ack.slice(0, ackRows).map((a, i) => {
            const meta = IC_PROBLEM[a.state] ?? { sev: 'unknown' as IcingaState, short: a.state.toUpperCase() }
            return (
              <IcingaSideRow key={`${a.host}|${a.service}|${i}`} kind={a.kind} host={a.host} service={a.label || a.service || 'Host'}
                right={a.since > 0 ? `seit ${icingaAge(nowTick - a.since)}` : '—'}
                state={meta.sev} badge={meta.short} height={IC_CQ.side} />
            )
          })}
        </div>
      )}

      {grpRows > 0 && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: `${IC_CQ.rowGap}cqmin`, overflow: 'hidden' }}>
          <IcingaSection title="Gruppen" right={`${data.groups.length} überwacht`} />
          {data.groups.slice(0, grpRows).map((g) => <IcingaGroupRow key={g.name} g={g} wide={false} maxH={IC_CQ.grpRow * 1.8} />)}
        </div>
      )}
      {/* Bleibt nach allen Baendern Flaeche uebrig, schiebt dieser Fuellraum sie nach oben,
          statt die Zeilen ueberdehnt auseinanderzuziehen. */}
      {grpRows === 0 && <div style={{ flex: 1, minHeight: 0 }} />}
    </div>
  )
}

/** Gruppen-Gesundheit als Nebenspalte der Gesamtuebersicht. */
function IcingaGroupPanel({ data, avail }: { data: IcingaSummary; avail: number }) {
  const s = useSkin()
  const bad = data.groups.filter((g) => icingaGroupState(g) !== null)
  const fitAll = icFit(Math.max(0, avail - IC_CQ.section), IC_CQ.grpRow)
  const hasMore = data.groups.length > fitAll
  const fit = hasMore ? icFit(Math.max(0, avail - IC_CQ.section), IC_CQ.grpRow, IC_CQ.moreSide) : fitAll
  const rows = data.groups.slice(0, Math.max(1, fit))
  const hidden = data.groups.length - rows.length
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: `${IC_CQ.rowGap}cqmin`, overflow: 'hidden' }}>
      <IcingaSection title="Gruppen" right={bad.length ? `${bad.length} betroffen` : 'alle unauffällig'}
        rightColor={bad.length ? s.st.critical.color : undefined} />
      {rows.map((g) => <IcingaGroupRow key={g.name} g={g} wide={false} maxH={IC_CQ.grpRow * 2} />)}
      {hidden > 0 && (
        <div style={{ flex: 'none', height: `${IC_CQ.moreSide}cqmin`, display: 'flex', alignItems: 'center' }}>
          <IcingaCap text={`+ ${hidden} weitere`} size="2.6cqmin" />
        </div>
      )}
    </div>
  )
}

/**
 * „Seit wann brennt es?" — die am laengsten offene Meldung in einem schmalen Band.
 * Sie steht sonst nirgends und beantwortet die erste Frage, die vor dem Fernseher
 * gestellt wird. Bewusst sparsam besetzt: „seit X" darf nie abgeschnitten werden,
 * deshalb schrumpfen nur Host und Dienstname.
 */
function IcingaOldestBand({ data }: { data: IcingaSummary }) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const s = useSkin()
  const o = data.oldestProblem
  if (!o) return null
  const meta = IC_PROBLEM[o.state] ?? { sev: 'unknown' as IcingaState, short: o.state.toUpperCase() }
  return (
    <div style={{
      flex: 'none', height: `${IC_CQ.oldest}cqmin`, display: 'flex', alignItems: 'center', gap: '1.6cqmin',
      overflow: 'hidden', borderLeft: `0.8cqmin solid ${s.st[meta.sev].fill}`, paddingLeft: '1.6cqmin',
      background: s.panel, borderRadius: '0.6cqmin', paddingRight: '1.6cqmin',
    }}>
      <span style={{ flex: 'none', display: 'flex' }}><IcingaCap text="Längste" size="2.5cqmin" /></span>
      <span style={{ ...IC_ELL, flex: '0 1 auto', minWidth: 0, maxWidth: '38%', fontFamily: IC_MONO, fontSize: '3.2cqmin', fontWeight: 600, color: s.txt }}>{o.host}</span>
      <span style={{ ...IC_ELL, flex: '1 1 auto', minWidth: 0, fontSize: '3cqmin', color: s.dim }}>{[o.label || o.service || 'Host', o.output].filter(Boolean).join('  ·  ')}</span>
      <span style={{ flex: 'none', whiteSpace: 'nowrap', fontFamily: IC_MONO, fontSize: '3.2cqmin', fontWeight: 600, color: s.st[meta.sev].color }}>
        {o.since > 0 ? `seit ${icingaAge(nowTick - o.since)}` : '—'}
      </span>
    </div>
  )
}

// --- Baustein: Gesamtuebersicht -------------------------------------------
function IcingaOverview({ data, size, maxRows }: { data: IcingaSummary; size: { w: number; h: number }; maxRows: number }) {
  const nowTick = useIcingaNow(data.fetchedAt)
  const s = useSkin()
  const { hosts, services, totals } = data
  const worst = icingaWorst(data)
  const svcBad = services.critical + services.warning + services.unknown
  const hostBad = hosts.down + hosts.unreachable
  // Faerben nur, wenn wirklich etwas OFFEN ist: sind alle drei Warnungen bestaetigt,
  // bleibt die Zahl neutral — es wird ja bereits daran gearbeitet.
  const svcOpen = data.problems.filter((p) => p.kind === 'service').length
  const hostOpen = data.problems.filter((p) => p.kind === 'host').length
  const svcSev: IcingaState = services.critical ? 'critical' : services.warning ? 'warning' : services.unknown ? 'unknown' : 'ok'
  const hostSev: IcingaState = hosts.down ? 'critical' : hosts.unreachable ? 'unknown' : 'ok'
  const ack = hosts.acknowledged + services.acknowledged
  const down = hosts.inDowntime + services.inDowntime

  // Baender nach Platz zuschalten: erst die Zahlen, dann die Aufschluesselung, dann die Fusszeile.
  const base = IC_CQ.edge * 2 + IC_CQ.pad * 2 + IC_CQ.header + IC_CQ.gap + IC_CQ.strip + IC_CQ.gap
  const withChips = size.h - base >= 26
  const withFoot = size.h - base - (withChips ? IC_CQ.chips + IC_CQ.gap : 0) >= 24
  const fixed = base + (withChips ? IC_CQ.chips + IC_CQ.gap : 0) + (withFoot ? IC_CQ.foot + IC_CQ.gap : 0)
  const main = Math.max(0, size.h - fixed)
  // Zweispaltig, sobald die Region breit genug ist: links die Meldungen, rechts die
  // Gruppen-Gesundheit und der Verlauf. Genau das fuellt den Ruhezustand mit Aussage.
  const split = size.w >= 152 && main >= 26
  // Hochkant statt breit: dann stehen die Gruppen UNTER der Liste.
  const stackGroups = !split && data.groups.length > 0 && main >= 52
  const sparkH = split && main >= 40 && data.history.length >= 2 ? IC_CQ.spark : 0
  // Fusszeile nach BREITE stufen statt alles gleichzeitig zu kuerzen: in einer eher
  // quadratischen Region (16:9 ergibt 178 cqmin Breite, 4:3 nur 133) passten sonst zwar
  // alle fuenf Angaben nebeneinander, aber jede einzelne endete auf „…". Lieber weniger
  // Angaben vollstaendig als fuenf abgeschnittene.
  const footWide = size.w >= 120
  const footFull = size.w >= 170

  const chips: { state: IcingaState; label: string; value: number }[] = [
    { state: 'critical', label: 'Krit', value: services.critical },
    { state: 'warning', label: 'Warn', value: services.warning },
    { state: 'unknown', label: 'Unbek', value: services.unknown },
    { state: 'critical', label: 'Host aus', value: hosts.down },
    { state: 'unknown', label: 'Host unerr', value: hosts.unreachable },
  ]
  const h = data.icinga
  const hot = data.topHosts[0]

  // Zahlenband: Dienste und Hosts gleichwertig, dazu das sonst Unsichtbare
  // (bestaetigt / in Wartung), die ueberfaelligen Pruefungen und — auf breiten
  // Regionen — die Erholungen der letzten Stunde. Letztere sind im Ruhezustand oft
  // die einzige Zahl, die sich ueberhaupt bewegt.
  const stats: { label: string; value: string; sub?: string; state?: IcingaState; hot?: boolean }[] = [
    { label: 'Dienste', value: String(svcBad), sub: `von ${totals.services}`, state: svcSev, hot: svcOpen > 0 },
    { label: 'Hosts', value: String(hostBad), sub: `von ${totals.hosts}`, state: hostSev, hot: hostOpen > 0 },
    { label: 'Ausgeblendet', value: String(ack), sub: `${down} in Wartung`, state: 'warning' as const },
    { label: 'Überfällig', value: String(data.staleChecks), sub: 'Prüfungen', state: 'critical' as const, hot: true },
  ]
  if (split) stats.push({ label: 'Erholt', value: String(data.recovered.length), sub: 'letzte Stunde', state: 'ok' as const })

  // Links: entweder das Band „laengste offene Meldung" plus Liste — oder, wenn nichts
  // offen ist, die Ruhezustands-Tafel.
  const oldestBand = data.problems.length > 0 && data.oldestProblem && main >= 34 ? IC_CQ.oldest + IC_CQ.rowGap : 0
  const listAvail = Math.max(0, main - oldestBand - (stackGroups ? Math.min(46, main * 0.42) + IC_CQ.gap : 0))
  const groupBand = stackGroups ? Math.min(46, main * 0.42) : 0

  const list = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: `${IC_CQ.rowGap}cqmin`, overflow: 'hidden' }}>
      {oldestBand > 0 && <IcingaOldestBand data={data} />}
      <IcingaProblemList data={data} avail={listAvail} maxRows={maxRows} calmGroups={!split && !stackGroups} />
    </div>
  )

  return (
    <>
      <IcingaHeader state={worst} word={IC_WORD[worst]}
        right={`${h?.nodeName || 'Icinga'} · ${icingaClock(nowTick)}`} />

      <div style={{
        flex: 'none', height: `${IC_CQ.strip}cqmin`, display: 'flex', overflow: 'hidden',
        background: s.panel, borderRadius: '0.8cqmin',
        boxShadow: `inset 0 0 0 max(1px, 0.12cqmin) ${s.edge}`,
      }}>
        <IcingaStatGrid cols={stats.length} rows={1} items={stats} />
      </div>

      {withChips && (
        <div style={{ flex: 'none', height: `${IC_CQ.chips}cqmin`, display: 'flex', alignItems: 'center', gap: '3cqmin', overflow: 'hidden' }}>
          {chips.map((ch) => (
            <span key={ch.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '1cqmin', flex: 'none' }}>
              <IcingaDot state={ch.state} size="1.4cqmin" />
              <IcingaCap text={ch.label} size="2.6cqmin" />
              <span style={{ fontFamily: IC_MONO, fontSize: '3.2cqmin', fontWeight: 600, color: ch.value ? s.st[ch.state].color : s.mute }}>{ch.value}</span>
            </span>
          ))}
          <span style={{ flex: 1 }} />
          {/* Rechts steht, was gerade die zweite Frage beantwortet: bei offenen Meldungen
              der Host, auf den sich die meisten haeufen — sonst die Ruhezustands-Zahlen.
              Zweispaltig steht „Erholt" schon im Zahlenband, dann waere es dort doppelt. */}
          {size.w >= 155 && hot && hot.count > 1 ? (
            <IcingaCap size="2.6cqmin" text={`Brennpunkt ${hot.host} · ${hot.count}`} />
          ) : !split && size.w >= 160 ? (
            <IcingaCap size="2.6cqmin" text={`${data.recovered.length} erholt · ${data.groups.length} Gruppen`} />
          ) : null}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: `${IC_CQ.gap}cqmin`, overflow: 'hidden' }}>
        {stackGroups ? (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: `${IC_CQ.gap}cqmin`, overflow: 'hidden' }}>
            {list}
            <div style={{ flex: 'none', height: `${groupBand}cqmin`, display: 'flex', overflow: 'hidden' }}>
              <IcingaGroupPanel data={data} avail={groupBand} />
            </div>
          </div>
        ) : list}
        {split && (
          <div style={{
            flex: '0 0 37%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column',
            gap: `${IC_CQ.gap}cqmin`, overflow: 'hidden', borderLeft: icHair(s), paddingLeft: `${IC_CQ.gap}cqmin`,
          }}>
            <IcingaGroupPanel data={data} avail={Math.max(0, main - (sparkH ? sparkH + IC_CQ.gap : 0))} />
            {sparkH > 0 && <IcingaTrendStrip data={data} height={sparkH} />}
          </div>
        )}
      </div>

      {withFoot && (
        <div style={{ flex: 'none', height: `${IC_CQ.foot}cqmin`, display: 'flex', alignItems: 'center', gap: '3cqmin', borderTop: icHair(s), overflow: 'hidden' }}>
          {h ? (
            <>
              <IcingaCap text={`Prüfungen/min ${h.checksPerMinute}`} size="2.6cqmin" />
              {footWide && <IcingaCap text={`Latenz ${icingaSeconds(h.latency)}`} size="2.6cqmin" />}
              {footFull && <IcingaCap text={`Ausführung ${icingaSeconds(h.executionTime)}`} size="2.6cqmin" />}
              <IcingaCap text={`Laufzeit ${icingaUptime(h.uptimeSeconds)}`} size="2.6cqmin"
                color={h.uptimeSeconds > 0 && h.uptimeSeconds < 3600 ? s.st.warning.color : undefined} />
              <span style={{ flex: 1 }} />
              {footFull && <IcingaCap text={h.version || ''} size="2.6cqmin" />}
            </>
          ) : (
            <IcingaCap text="Icinga-Eigenzustand nicht abfragbar" size="2.6cqmin" color={s.st.warning.color} />
          )}
        </div>
      )}
    </>
  )
}

export function Clock({ format, tickMs }: { format?: string; tickMs?: number }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), Math.max(250, tickMs ?? 1000))
    return () => clearInterval(t)
  }, [tickMs])
  const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: format === 'hms' ? '2-digit' : undefined })
  const date = now.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  // cqmin = relativ zur Regionsgröße (Wrapper hat container-type: size) -> passt sich an
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
      <div className="font-mono font-bold tabular-nums" style={{ fontSize: '22cqmin', lineHeight: 1 }}>{time}</div>
      <div className="text-slate-300" style={{ fontSize: '6cqmin', marginTop: '2cqmin' }}>{date}</div>
    </div>
  )
}
