/**
 * CMS-Backend: HTTP-API und WebSocket-Live-Push.
 */
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { WebSocketServer } from 'ws'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { sql, db } from './db/index.js'
import { displays } from './db/schema.js'
import { seedAdmin } from './seed.js'
import { AppError, newRef } from './lib/errors.js'
import { auditMiddleware } from './lib/audit.js'
import { loadUser, userFromCookieHeader, type AppEnv } from './auth/middleware.js'
import { addPeer, setPeerLayout, removePeer } from './ws/presence.js'
import { authRoutes } from './routes/auth.js'
import { mediaRoutes } from './routes/media.js'
import { layoutRoutes } from './routes/layouts.js'
import { displayRoutes, COMMANDS } from './routes/displays.js'
import { scheduleRoutes } from './routes/schedules.js'
import { userRoutes } from './routes/users.js'
import { displayGroupRoutes } from './routes/displayGroups.js'
import { campaignRoutes } from './routes/campaigns.js'
import { playerRoutes } from './routes/player.js'
import { feedRoutes } from './routes/feed.js'
import { weatherRoutes } from './routes/weather.js'
import { auditRoutes } from './routes/audit.js'
import { statsRoutes } from './routes/stats.js'
import { emergencyRoutes } from './routes/emergency.js'
import { icingaRoutes } from './routes/icinga.js'
import { settingsRoutes } from './routes/settings.js'
import { moduleRoutes } from './routes/modules.js'
import { requireModule } from './lib/modules.js'
import { registerConnection, unregisterConnection, touchDisplay, logCommandResult, pingAll } from './ws/players.js'
import { setPlayerState, resetPlayerStates } from './ws/playerState.js'
import { checkDeviceAccess } from './lib/deviceAuth.js'
import { addWallPeer, removeWallPeer } from './ws/wall.js'
import { getBrand } from './lib/brand.js'

// --- Schutzgrenzen fuer den (unauthentifizierten) Player-WebSocket -------------------
// /ws/player muss ohne Login erreichbar sein, damit sich ein neues Geraet ueberhaupt
// koppeln kann. Damit kann aber JEDER Rechner im LAN Nachrichten schicken - und jede
// Nachricht kann einen DB-Schreibvorgang ausloesen. Diese Grenzen verhindern, dass
// damit die Datenbank geflutet und der (auf 10 Verbindungen begrenzte) Pool blockiert wird.
const MSG_PER_SEC = 5          // Dauerrate je Verbindung (Player braucht ~1/s)
const MSG_BURST = 20           // kurzzeitige Spitzen erlaubt
const MAX_DROPPED = 200        // so viele verworfene Nachrichten -> Verbindung trennen
const MAX_MSG_BYTES = 16_000   // groessere Meldungen sind kein regulaerer Player
const TOUCH_MIN_MS = 30_000    // lastSeenAt hoechstens alle 30 s schreiben

/** Befehls-Rueckmeldung streng validieren - der Text landet im Display-Protokoll. */
const commandResultSchema = z.object({
  code: z.enum(COMMANDS),
  ok: z.boolean(),
  error: z.string().max(200).nullish(),
})

const app = new Hono<AppEnv>()

// Benutzer aus Session-Cookie laden (blockt nicht) + lückenloses Audit-Logging
app.use('*', loadUser)
app.use('*', auditMiddleware)

app.get('/api/health', async (c) => {
  try {
    await sql`select 1`
    return c.json({ status: 'ok', db: 'up', ts: new Date().toISOString() })
  } catch (err) {
    return c.json({ status: 'degraded', db: 'down', error: String(err) }, 503)
  }
})

app.route('/api/auth', authRoutes)
app.route('/api/media', mediaRoutes)
app.route('/api/layouts', layoutRoutes)
app.route('/api/displays', displayRoutes)
app.route('/api/schedules', scheduleRoutes)
app.route('/api/users', userRoutes)
app.route('/api/display-groups', displayGroupRoutes)
app.route('/api/campaigns', campaignRoutes)
app.route('/api/audit', auditRoutes)
app.route('/api/stats', statsRoutes)
app.route('/api/emergency', emergencyRoutes)
app.route('/api/player', playerRoutes)
app.route('/api/feed', feedRoutes)
app.route('/api/weather', weatherRoutes)
app.route('/api/icinga', icingaRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/modules', moduleRoutes)

// Abgeschaltete Module sind auch als Route zu. Die Oberflaeche blendet sie
// zusaetzlich aus - aber sie ist nicht die Sicherheitsgrenze.
app.use('/api/campaigns/*', requireModule('campaigns'))
app.use('/api/schedules/*', requireModule('schedule'))
app.use('/api/display-groups/*', requireModule('groups'))
app.use('/api/emergency/*', requireModule('emergency'))
app.use('/api/stats/*', requireModule('stats'))
app.use('/api/audit/*', requireModule('audit'))
app.use('/api/weather/*', requireModule('weather'))
app.use('/api/feed/*', requireModule('feeds'))
app.use('/api/icinga/*', requireModule('monitoring'))

// Bewusst ohne Anmeldung: die Anmeldeseite und der noch nicht gekoppelte Player
// muessen den Namen der Anlage anzeigen koennen, bevor es eine Sitzung gibt.
app.get('/api/brand', (c) => c.json({ brand: getBrand() }))

app.get('/', (c) => c.text(`${getBrand().name} CMS`))

// Einheitliche Fehlerbehandlung: bekannte AppErrors klar durchreichen,
// unerwartete Fehler mit Referenz-ID loggen und zurückgeben.
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code, detail: err.detail }, err.status as any)
  }
  // Ungueltige ID in der URL (z.B. /api/displays/abc): Postgres wirft 22P02
  // "invalid input syntax for type uuid". Das ist ein Eingabefehler des Aufrufers,
  // kein Serverfehler -> klare 400 statt 500 mit Stacktrace im Log.
  if ((err as any)?.code === '22P02') {
    return c.json({
      error: 'Ungueltige ID: Der Wert in der Adresse ist keine gueltige ID.',
      code: 'INVALID_ID',
    }, 400)
  }
  const ref = newRef()
  console.error(`[FEHLER ${ref}] ${c.req.method} ${c.req.path}:`, err)
  return c.json({
    error: 'Interner Serverfehler. Bitte die Referenz an den Entwickler geben.',
    code: 'INTERNAL',
    ref,
  }, 500)
})

app.notFound((c) =>
  c.json({ error: `Route nicht gefunden: ${c.req.method} ${c.req.path}`, code: 'ROUTE_NOT_FOUND' }, 404),
)

async function main() {
  await seedAdmin()

  // Beim Start ist noch kein Player verbunden -> alle als 'online' markierten Displays auf 'offline'
  // zuruecksetzen. Raeumt Karteileichen nach Server-Neustart oder hart getrennten Geraeten weg;
  // reale Player melden sich beim Reconnect sofort wieder als online.
  await db.update(displays).set({ status: 'offline' }).where(eq(displays.status, 'online'))
  // Wiedergabe-Telemetrie ist fluechtig: nach einem Neustart faengt sie bei null an
  // und fuellt sich mit dem naechsten Zustands-Herzschlag der Geraete (<= 10 s).
  resetPlayerStates()

  const port = Number(process.env.PORT ?? 3000)
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[cms] HTTP auf :${info.port}`)
  })

  // Drei WS-Endpunkte am selben HTTP-Server:
  // /ws/player (Displays) + /ws/presence (Editoren) + /ws/wall (Live-Raster im Admin)
  const playerWss = new WebSocketServer({ noServer: true })
  const presenceWss = new WebSocketServer({ noServer: true })
  const wallWss = new WebSocketServer({ noServer: true })

  ;(server as any).on('upgrade', (req: any, socket: any, head: any) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost')
    if (pathname === '/ws/player') {
      playerWss.handleUpgrade(req, socket, head, (ws) => playerWss.emit('connection', ws, req))
    } else if (pathname === '/ws/presence') {
      presenceWss.handleUpgrade(req, socket, head, (ws) => presenceWss.emit('connection', ws, req))
    } else if (pathname === '/ws/wall') {
      wallWss.handleUpgrade(req, socket, head, (ws) => wallWss.emit('connection', ws, req))
    } else {
      socket.destroy()
    }
  })

  // Player: Content-Live-Push + Heartbeat/Online-Status
  playerWss.on('connection', async (ws, req) => {
    // Liveness fuer den Heartbeat: als aktiv markieren, jeder Pong bestaetigt "noch da".
    ;(ws as any).isAlive = true
    ws.on('pong', () => { (ws as any).isAlive = true })
    const key = new URL(req.url ?? '', 'http://localhost').searchParams.get('key')
    if (!key) { ws.close(); return }

    // WICHTIG: Der Listener wird SOFORT angehaengt - vor den await-Aufrufen unten.
    // Sonst treffen Nachrichten, die der Player direkt nach dem Verbinden schickt,
    // in einem Fenster ohne Listener ein und gehen LAUTLOS verloren (nachgewiesen:
    // erste Zustandsmeldung/Befehlsergebnis kam nie an). Bis das Display aufgeloest
    // ist, werden sie gepuffert und danach in Reihenfolge verarbeitet.
    let displayId: string | null = null
    let isAuthorized = false
    const pending: string[] = []
    const MAX_PENDING = 20   // Schutz gegen ein Geraet, das vor der Anmeldung flutet

    // Missbrauchsschutz: /ws/player ist unauthentifiziert erreichbar (Pairing-Ablauf).
    // Ohne Bremse koennte ein beliebiger Rechner im LAN mit Nachrichten die DB fluten
    // (jede Meldung = ein INSERT/UPDATE) und mit 10 Pool-Verbindungen das ganze CMS lahmlegen.
    let tokens = MSG_BURST
    let refilled = Date.now()
    let dropped = 0
    function allow(): boolean {
      const now = Date.now()
      tokens = Math.min(MSG_BURST, tokens + ((now - refilled) / 1000) * MSG_PER_SEC)
      refilled = now
      if (tokens < 1) return false
      tokens -= 1
      return true
    }
    // lastSeenAt braucht keine Sekundenaufloesung -> hoechstens alle 30 s schreiben.
    let lastTouch = 0

    async function handleMessage(text: string, id: string) {
      if (text.length > MAX_MSG_BYTES) return
      try {
        const msg = JSON.parse(text)
        if (msg?.type === 'heartbeat') {
          if (Date.now() - lastTouch >= TOUCH_MIN_MS) { lastTouch = Date.now(); await touchDisplay(id) }
        // Player meldet zurueck, ob ein Fernsteuerbefehl wirklich ausgefuehrt wurde.
        // Nur von freigegebenen Displays und nur streng validiert - der Text landet im Protokoll.
        } else if (msg?.type === 'command-result') {
          if (!isAuthorized) return
          const p = commandResultSchema.safeParse(msg)
          if (!p.success) return
          await logCommandResult(id, p.data.code, p.data.ok, p.data.error ?? undefined)
        // Wiedergabe-Zustand fuer die Wall: was laeuft auf dem Geraet gerade wirklich?
        } else if (msg?.type === 'state') {
          setPlayerState(id, msg)
        }
      } catch { /* ignorieren */ }
    }

    ws.on('message', (data) => {
      const text = data.toString()
      if (!allow()) {
        // Anhaltendes Fluten -> Verbindung trennen (4429 = zu viele Anfragen)
        if (++dropped > MAX_DROPPED) { try { ws.close(4429, 'zu viele Nachrichten') } catch { /* ignorieren */ } }
        return
      }
      if (!displayId) { if (pending.length < MAX_PENDING) pending.push(text); return }
      void handleMessage(text, displayId)
    })

    const d = (await db.select().from(displays).where(eq(displays.hardwareKey, key)).limit(1))[0]
    if (!d) { ws.send(JSON.stringify({ type: 'error', error: 'unknown-display' })); ws.close(); return }
    // Identitaet nachweisen: der Rechnername allein genuegt nicht (im AD aufzaehlbar).
    // Altgeraete ohne hinterlegtes Geheimnis werden weiterhin akzeptiert.
    const deviceKey = new URL(req.url ?? '', 'http://localhost').searchParams.get('k')
    const acc = await checkDeviceAccess(d, deviceKey)
    if (!acc.ok) {
      ws.send(JSON.stringify({ type: 'error', error: 'device-auth', message: acc.reason }))
      ws.close(4403, 'Geraet nicht berechtigt')
      return
    }
    const client = await registerConnection(ws, key, d.id)
    ws.send(JSON.stringify({ type: 'hello', authorized: d.authorized }))
    isAuthorized = d.authorized
    displayId = d.id
    for (const text of pending.splice(0)) await handleMessage(text, d.id)
    ws.on('close', () => { void unregisterConnection(client) })
    ws.on('error', () => { void unregisterConnection(client) })
  })

  // Heartbeat: alle 30 s pingen; wer bis zum naechsten Tick nicht mit Pong antwortet
  // (z.B. hart abgezogenes Geraet ohne sauberen WS-Close) wird getrennt -> Status offline
  // laeuft ueber das 'close'-Event von terminate() + unregisterConnection.
  const PLAYER_PING_MS = 30_000
  const playerHeartbeat = setInterval(() => {
    for (const ws of playerWss.clients) {
      if ((ws as any).isAlive === false) { ws.terminate(); continue }
      ;(ws as any).isAlive = false
      try { ws.ping() } catch { /* ignorieren */ }
    }
    // Zusaetzlich ein App-Level-Ping: haelt Proxy-Timeouts offen (nginx zaehlt nur
    // CMS->Player-Daten) und gibt dem Player ein Lebenszeichen, an dem er eine
    // halboffene ("tote") Verbindung erkennen und neu verbinden kann.
    pingAll()
  }, PLAYER_PING_MS)
  playerWss.on('close', () => clearInterval(playerHeartbeat))

  // Präsenz: authentifiziert per Session-Cookie; meldet, wer in welchem Layout ist
  presenceWss.on('connection', async (ws, req) => {
    const user = await userFromCookieHeader(req.headers.cookie)
    if (!user) { ws.close(4401, 'nicht angemeldet'); return }
    addPeer(ws, user.id, user.username)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg?.type === 'enter') setPeerLayout(ws, String(msg.layoutId))
        else if (msg?.type === 'leave') setPeerLayout(ws, null)
      } catch { /* ignorieren */ }
    })
    ws.on('close', () => removePeer(ws))
    ws.on('error', () => removePeer(ws))
  })

  // Wall: authentifiziert per Session-Cookie (wie /ws/presence). Bekommt beim Verbinden
  // sofort den vollstaendigen Snapshot und danach jede Aenderung als Push.
  wallWss.on('connection', async (ws, req) => {
    const user = await userFromCookieHeader(req.headers.cookie)
    if (!user) { ws.close(4401, 'nicht angemeldet'); return }
    ;(ws as any).isAlive = true
    ws.on('pong', () => { (ws as any).isAlive = true })
    await addWallPeer(ws)
    ws.on('close', () => removeWallPeer(ws))
    ws.on('error', () => removeWallPeer(ws))
  })

  console.log('[cms] WS aktiv: /ws/player (Displays) + /ws/presence (Editoren) + /ws/wall (Live-Raster)')
}

main().catch((err) => {
  console.error('[cms] Startfehler:', err)
  process.exit(1)
})
