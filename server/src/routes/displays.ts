import { Hono } from 'hono'
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { displays, displayLogs } from '../db/schema.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole, currentUser } from '../auth/middleware.js'
import { pushToDisplay, onlineDisplayIds } from '../ws/players.js'
import { buildWallSnapshot, notifyWallDisplaysChanged } from '../ws/wall.js'
import { forgetDisplay } from '../ws/playerState.js'
import { enqueueOsCommand, forgetOsCommands, type OsCommandCode } from '../lib/osCommands.js'
import { Err } from '../lib/errors.js'

export const COMMANDS = ['RELOAD', 'SCREENSHOT', 'RESTART', 'REBOOT', 'SHUTDOWN'] as const

export const displayRoutes = new Hono<AppEnv>()
displayRoutes.use('*', requireAuth)

displayRoutes.get('/', async (c) => {
  const rows = await db.select().from(displays).orderBy(desc(displays.createdAt))
  return c.json({ displays: rows })
})

/**
 * Snapshot fuer die Wall: Stammdaten + der vom Geraet gemeldete Wiedergabezustand (RAM).
 * Zwei Verwendungen: erster Paint (waehrend der WS-Handshake laeuft) und Notnagel-Poll,
 * falls der WS-Aufbau scheitert (z. B. Reverse-Proxy ohne /ws/-Durchreichung).
 * WICHTIG: muss VOR '/:id' stehen, sonst schluckt '/:id' den Pfad "wall".
 */
displayRoutes.get('/wall', async (c) => {
  return c.json(await buildWallSnapshot())
})

displayRoutes.get('/:id', async (c) => {
  const row = (await db.select().from(displays).where(eq(displays.id, c.req.param('id'))).limit(1))[0]
  if (!row) return c.json({ error: 'Nicht gefunden' }, 404)
  return c.json({ display: row })
})

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  defaultLayoutId: z.string().uuid().nullable().optional(),
  timezone: z.string().optional(),
}).strict()

displayRoutes.patch('/:id', requireRole('grafik'), async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe' }, 400)
  const row = (await db.update(displays)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(displays.id, c.req.param('id'))).returning())[0]
  if (!row) return c.json({ error: 'Nicht gefunden' }, 404)
  pushToDisplay(row.id, { type: 'reload', reason: 'display-updated', ts: Date.now() })
  notifyWallDisplaysChanged()
  return c.json({ display: row })
})

/** Display autorisieren (nach Pairing durch den Player). Status bleibt WS-gesteuert. */
displayRoutes.post('/:id/authorize', requireRole('grafik'), async (c) => {
  const online = onlineDisplayIds().has(c.req.param('id'))
  const row = (await db.update(displays)
    .set({ authorized: true, status: online ? 'online' : 'offline', updatedAt: new Date() })
    .where(eq(displays.id, c.req.param('id'))).returning())[0]
  if (!row) return c.json({ error: 'Nicht gefunden' }, 404)
  // Player wartet ggf. auf Freigabe -> sofort neu laden lassen
  pushToDisplay(row.id, { type: 'authorized', ts: Date.now() })
  pushToDisplay(row.id, { type: 'reload', reason: 'authorized', ts: Date.now() })
  notifyWallDisplaysChanged()
  return c.json({ display: row })
})

displayRoutes.delete('/:id', requireRole('admin'), async (c) => {
  const id = c.req.param('id')
  await db.delete(displays).where(eq(displays.id, id))
  forgetDisplay(id)
  forgetOsCommands(id)
  notifyWallDisplaysChanged()
  return c.json({ ok: true })
})

/** Uptime (24h) + jüngste Online/Offline- und Log-Ereignisse eines Displays. */
displayRoutes.get('/:id/events', async (c) => {
  const id = c.req.param('id')
  const since = new Date(Date.now() - 24 * 3600 * 1000)
  const cur = (await db.select({ status: displays.status }).from(displays).where(eq(displays.id, id)).limit(1))[0]
  if (!cur) throw Err.notFound('Display nicht gefunden')

  const before = (await db.select({ code: displayLogs.code, at: displayLogs.createdAt }).from(displayLogs)
    .where(and(eq(displayLogs.displayId, id), lt(displayLogs.createdAt, since), inArray(displayLogs.code, ['ONLINE', 'OFFLINE'])))
    .orderBy(desc(displayLogs.createdAt)).limit(1))[0]
  const events = await db.select({ code: displayLogs.code, at: displayLogs.createdAt }).from(displayLogs)
    .where(and(eq(displayLogs.displayId, id), gte(displayLogs.createdAt, since), inArray(displayLogs.code, ['ONLINE', 'OFFLINE'])))
    .orderBy(asc(displayLogs.createdAt))

  let state = before ? before.code === 'ONLINE' : cur.status === 'online'
  let cursor = since.getTime()
  let onlineMs = 0
  for (const e of events) {
    const t = new Date(e.at).getTime()
    if (state) onlineMs += t - cursor
    cursor = t
    state = e.code === 'ONLINE'
  }
  if (state) onlineMs += Date.now() - cursor
  const uptime24h = Math.min(100, Math.round((onlineMs / (24 * 3600 * 1000)) * 100))

  const recent = await db.select({ level: displayLogs.level, code: displayLogs.code, message: displayLogs.message, createdAt: displayLogs.createdAt })
    .from(displayLogs).where(eq(displayLogs.displayId, id)).orderBy(desc(displayLogs.createdAt)).limit(25)

  return c.json({ uptime24h, events: recent })
})

/**
 * Kopplung zuruecksetzen: loescht das hinterlegte Geraete-Geheimnis.
 * Noetig, wenn ein Geraet neu aufgesetzt wurde - dann hat es ein neues Geheimnis und
 * wuerde sonst dauerhaft mit 403 abgewiesen. Nach dem Zuruecksetzen bindet sich das
 * naechste Geraet, das sich unter dieser Kennung meldet, neu (Trust-on-first-use).
 * Bewusst nur fuer Admins - damit laesst sich der Uebernahmeschutz aufheben.
 */
displayRoutes.post('/:id/reset-device', requireRole('admin'), async (c) => {
  const id = c.req.param('id')
  const d = (await db.select().from(displays).where(eq(displays.id, id)).limit(1))[0]
  if (!d) throw Err.notFound('Display nicht gefunden')
  await db.update(displays).set({ deviceSecretHash: null }).where(eq(displays.id, id))
  await db.insert(displayLogs).values({
    displayId: id, level: 'info', code: 'DEVICE_RESET',
    message: `Kopplung zurueckgesetzt durch ${currentUser(c).username} - das naechste Geraet unter dieser Kennung wird neu gebunden.`,
  }).catch(() => {})
  return c.json({ ok: true })
})

/** Fernsteuerbefehl an ein Display senden (über den WS-Kanal). */
displayRoutes.post('/:id/command', requireRole('grafik'), async (c) => {
  const body = await c.req.json().catch(() => null)
  const code = body?.code
  if (!COMMANDS.includes(code)) throw Err.badRequest(`Unbekannter Befehl. Erlaubt: ${COMMANDS.join(', ')}`)
  const d = (await db.select().from(displays).where(eq(displays.id, c.req.param('id'))).limit(1))[0]
  if (!d) throw Err.notFound('Display nicht gefunden')
  const isOs = code === 'REBOOT' || code === 'SHUTDOWN' || code === 'SCREENSHOT'
  // OS-Befehle koennen auch ein Geraet erreichen, dessen Anzeige haengt - der Agent laeuft
  // unabhaengig vom Browser. Deshalb hier keine Online-Pflicht, sondern nur ein Hinweis.
  if (!isOs && !onlineDisplayIds().has(d.id)) throw Err.badRequest('Display ist offline — Befehl kann nicht zugestellt werden')

  pushToDisplay(d.id, { type: 'command', code, payload: body?.payload ?? null, ts: Date.now() })
  let queued: string | null = null
  if (isOs) {
    // Zusaetzlich fuer den Geraeteagenten einreihen: die Webseite kann den Rechner nicht
    // neu starten. Holt der Agent den Befehl ab, fuehrt er ihn aus und meldet zurueck.
    queued = enqueueOsCommand(d.id, code as OsCommandCode)
    await db.insert(displayLogs).values({
      displayId: d.id, level: 'info', code: 'COMMAND_QUEUED',
      message: `Befehl ${code} eingereiht (Vorgang ${queued}) — wird vom Geraeteagenten innerhalb einer Minute abgeholt.`,
    }).catch(() => {})
  }
  return c.json({ ok: true, sent: code, queued })
})
