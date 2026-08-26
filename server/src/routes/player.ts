/**
 * Player-API (ohne Session-Auth, identifiziert per hardwareKey):
 *  POST /api/player/register  — Player meldet sich an, bekommt Pairing-Code bis autorisiert
 *  GET  /api/player/content   — aufgelöster Inhalt (Layout-Baum) für dieses Display
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { icingaSummary } from './icinga.js'
import { checkDeviceAccess, hashSecret } from '../lib/deviceAuth.js'
import { takeOsCommands } from '../lib/osCommands.js'
import { getLanguage } from '../lib/settings.js'
import { z } from 'zod'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { db } from '../db/index.js'
import { displays, proofOfPlay, displayLogs } from '../db/schema.js'
import { resolveDisplayContent } from '../lib/resolve.js'
import { MEDIA_DIR } from '../lib/storage.js'
import { Err } from '../lib/errors.js'

/** Screenshots sind Bildschirmfotos, keine Videodateien - 8 MB sind grosszuegig. */
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024

/** Dateisignatur pruefen (JPEG/PNG/WebP/GIF) - die Typangabe des Geraets ist nicht vertrauenswuerdig. */
function isImageBuffer(b: Buffer): boolean {
  if (b.length < 12) return false
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true                     // JPEG
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return true      // PNG
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return true                       // GIF
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return true
  return false
}

export const playerRoutes = new Hono()

function newPairingCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

const registerSchema = z.object({
  hardwareKey: z.string().min(8),
  name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  clientVersion: z.string().optional(),
  macAddress: z.string().optional(),
  /** Geraete-Geheimnis (siehe lib/deviceAuth.ts). Optional: Altgeraete kennen es noch nicht. */
  deviceKey: z.string().max(200).optional(),
})

playerRoutes.post('/register', async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe' }, 400)
  const { hardwareKey, name, width, height, clientVersion, macAddress } = parsed.data

  let d = (await db.select().from(displays).where(eq(displays.hardwareKey, hardwareKey)).limit(1))[0]
  if (d) {
    // Bestehendes Display: Geheimnis pruefen bzw. beim ersten Mal binden.
    const acc = await checkDeviceAccess(d, parsed.data.deviceKey)
    if (!acc.ok) return c.json({ error: acc.reason }, 403)
  }
  if (!d) {
    d = (await db.insert(displays).values({
      hardwareKey,
      name: name || `Display ${hardwareKey.slice(0, 6)}`,
      pairingCode: newPairingCode(),
      resolutionW: width ?? null,
      resolutionH: height ?? null,
      clientVersion: clientVersion ?? null,
      macAddress: macAddress ?? null,
      status: 'pending',
      authorized: false,
      // Neues Geraet mit Geheimnis -> direkt binden (spaeter ist es Pflicht).
      deviceSecretHash: parsed.data.deviceKey && parsed.data.deviceKey.length >= 16 ? hashSecret(parsed.data.deviceKey) : null,
    }).returning())[0]
  } else {
    await db.update(displays)
      .set({
        resolutionW: width ?? d.resolutionW, resolutionH: height ?? d.resolutionH,
        clientVersion: clientVersion ?? d.clientVersion, macAddress: macAddress ?? d.macAddress,
        updatedAt: new Date(),
      })
      .where(eq(displays.id, d.id))
  }

  return c.json({
    displayId: d.id,
    name: d.name,
    authorized: d.authorized,
    pairingCode: d.authorized ? null : d.pairingCode,
  })
})

playerRoutes.get('/content', async (c) => {
  const key = c.req.query('key')
  if (!key) return c.json({ error: 'key fehlt' }, 400)
  const d = (await db.select().from(displays).where(eq(displays.hardwareKey, key)).limit(1))[0]
  if (!d) return c.json({ error: 'Unbekanntes Display' }, 404)
  const acc = await checkDeviceAccess(d, c.req.query('k'))
  if (!acc.ok) return c.json({ error: acc.reason }, 403)
  // Der Fernseher hat KEINE Sitzung und kann /api/settings nicht abrufen. Die
  // organisationsweite Sprache reist deshalb hier mit — auf beiden Wegen, denn auch
  // der Kopplungsbildschirm (noch nicht freigegeben) ist beschrifteter Text.
  const language = await getLanguage()
  if (!d.authorized) {
    return c.json({ authorized: false, name: d.name, pairingCode: d.pairingCode, language })
  }
  const content = await resolveDisplayContent(d)
  return c.json({
    authorized: true,
    language,
    display: { id: d.id, name: d.name, width: d.resolutionW, height: d.resolutionH },
    ...content,
  })
})

/**
 * Icinga-Status fuer die Statuskachel. Der Fernseher hat keine Sitzung, deshalb hier
 * ueber den Display-Schluessel statt ueber eine Rolle. Nur FREIGEGEBENE Displays -
 * ein ungekoppeltes Geraet bekommt keine Monitoring-Daten.
 */
playerRoutes.get('/icinga', async (c) => {
  const key = c.req.query('key')
  if (!key) return c.json({ error: 'key fehlt' }, 400)
  const d = (await db.select().from(displays).where(eq(displays.hardwareKey, key)).limit(1))[0]
  if (!d) return c.json({ error: 'Unbekanntes Display' }, 404)
  const acc = await checkDeviceAccess(d, c.req.query('k'))
  if (!acc.ok) return c.json({ error: acc.reason }, 403)
  if (!d.authorized) return c.json({ error: 'Display ist nicht freigegeben' }, 403)
  return c.json(await icingaSummary())
})

/**
 * Geraeteagent holt offene Betriebssystem-Befehle ab (Neustart/Herunterfahren/Screenshot).
 * Authentifiziert wie der Player ueber hardwareKey + Geraete-Geheimnis.
 * Die Befehle werden beim Abholen ENTFERNT - jeder geht genau einmal raus.
 */
playerRoutes.get('/os-commands', async (c) => {
  const key = c.req.query('key')
  if (!key) return c.json({ error: 'key fehlt' }, 400)
  const d = (await db.select().from(displays).where(eq(displays.hardwareKey, key)).limit(1))[0]
  if (!d) return c.json({ error: 'Unbekanntes Display' }, 404)
  const acc = await checkDeviceAccess(d, c.req.query('k'))
  if (!acc.ok) return c.json({ error: acc.reason }, 403)
  if (!d.authorized) return c.json({ error: 'Display ist nicht freigegeben' }, 403)
  return c.json({ commands: takeOsCommands(d.id) })
})

/** Rueckmeldung des Agenten: hat es geklappt? Landet im Display-Protokoll. */
const ackSchema = z.object({
  key: z.string().min(8),
  deviceKey: z.string().max(200).optional(),
  id: z.string().max(64),
  code: z.enum(['REBOOT', 'SHUTDOWN', 'SCREENSHOT']),
  ok: z.boolean(),
  error: z.string().max(200).optional(),
})

playerRoutes.post('/os-commands/ack', async (c) => {
  const parsed = ackSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw Err.badRequest('Ungültige Rückmeldung')
  const p = parsed.data
  const d = (await db.select().from(displays).where(eq(displays.hardwareKey, p.key)).limit(1))[0]
  if (!d) return c.json({ error: 'Unbekanntes Display' }, 404)
  const acc = await checkDeviceAccess(d, p.deviceKey ?? c.req.query('k'))
  if (!acc.ok) return c.json({ error: acc.reason }, 403)
  await db.insert(displayLogs).values({
    displayId: d.id,
    level: p.ok ? 'info' : 'error',
    code: p.ok ? 'COMMAND_OK' : 'COMMAND_FAILED',
    message: p.ok
      ? `Geraeteagent hat ${p.code} ausgefuehrt (Vorgang ${p.id}).`
      : `Geraeteagent konnte ${p.code} NICHT ausfuehren (Vorgang ${p.id})${p.error ? ': ' + p.error : ''}`,
  }).catch(() => {})
  return c.json({ ok: true })
})

/** Proof-of-Play: der Player meldet gebatcht, was er tatsächlich angezeigt hat. */
const popSchema = z.object({
  key: z.string().min(8),
  /** Geraete-Geheimnis (siehe lib/deviceAuth.ts). Optional: Altgeraete kennen es noch nicht. */
  deviceKey: z.string().max(200).optional(),
  events: z.array(z.object({
    layoutId: z.string().uuid().nullable().optional(),
    widgetId: z.string().uuid().nullable().optional(),
    mediaId: z.string().uuid().nullable().optional(),
    startedAt: z.string().datetime(),
    durationSeconds: z.number().nonnegative().optional(),
  })).max(500),
})

playerRoutes.post('/pop', async (c) => {
  const parsed = popSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw Err.badRequest('Ungültige Proof-of-Play-Daten')
  const d = (await db.select({ id: displays.id, authorized: displays.authorized, deviceSecretHash: displays.deviceSecretHash })
    .from(displays).where(eq(displays.hardwareKey, parsed.data.key)).limit(1))[0]
  if (!d || !d.authorized) throw Err.forbidden('Display unbekannt oder nicht autorisiert')
  const accP = await checkDeviceAccess(d, parsed.data.deviceKey ?? c.req.query('k'))
  if (!accP.ok) throw Err.forbidden(accP.reason ?? 'Geraet nicht berechtigt')
  if (parsed.data.events.length === 0) return c.json({ ok: true, stored: 0 })

  await db.insert(proofOfPlay).values(parsed.data.events.map((e) => ({
    displayId: d.id,
    layoutId: e.layoutId ?? null,
    widgetId: e.widgetId ?? null,
    mediaId: e.mediaId ?? null,
    startedAt: new Date(e.startedAt),
    durationSeconds: e.durationSeconds ?? null,
  })))
  return c.json({ ok: true, stored: parsed.data.events.length })
})

/** Screenshot vom Player entgegennehmen (nach SCREENSHOT-Befehl). Ablage: media/screenshots/<id>.jpg */
playerRoutes.post('/screenshot', async (c) => {
  const key = c.req.query('key')
  if (!key) throw Err.badRequest('key fehlt')
  const d = (await db.select().from(displays).where(eq(displays.hardwareKey, key)).limit(1))[0]
  if (!d || !d.authorized) throw Err.forbidden('Display unbekannt oder nicht autorisiert')
  const accS = await checkDeviceAccess(d, c.req.query('k'))
  if (!accS.ok) throw Err.forbidden(accS.reason ?? 'Geraet nicht berechtigt')
  // Groesse VOR dem Einlesen begrenzen: parseBody puffert alles im Arbeitsspeicher.
  // nginx erlaubt bis 2 GB fuer Medien-Uploads - ein Screenshot ist ein Bruchteil davon,
  // sonst koennte ein Geraet den CMS-Container mit einem einzigen Aufruf aus dem Speicher druecken.
  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > MAX_SCREENSHOT_BYTES) {
    throw Err.badRequest(`Screenshot zu gross (${Math.round(declared / 1024 / 1024)} MB, erlaubt sind ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MB).`)
  }
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) throw Err.badRequest('Feld "file" (Bild) fehlt')
  if (file.size > MAX_SCREENSHOT_BYTES) {
    throw Err.badRequest(`Screenshot zu gross (${Math.round(file.size / 1024 / 1024)} MB, erlaubt sind ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MB).`)
  }
  const buf = Buffer.from(await file.arrayBuffer())
  // Nur echte Bilder ablegen - anhand der Dateisignatur, nicht anhand der Angabe des Geraets.
  if (!isImageBuffer(buf)) throw Err.badRequest('Die hochgeladene Datei ist kein Bild (JPEG/PNG erwartet).')
  const dir = join(MEDIA_DIR, 'screenshots')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${d.id}.jpg`), buf)
  await db.update(displays).set({ lastSeenAt: new Date() }).where(eq(displays.id, d.id))
  return c.json({ ok: true })
})
