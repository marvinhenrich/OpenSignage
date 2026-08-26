/**
 * Organisationsweite Einstellungen:
 *   GET   /api/settings  — jeder angemeldete Benutzer (die Oberflaeche braucht die Sprache)
 *   PATCH /api/settings  — NUR Rolle admin
 *
 * Die Sprache gilt fuer die ganze Installation. Nach einer Umstellung bekommen die
 * Displays ein `reload` ueber den bestehenden Live-Kanal, damit der Wechsel auch auf
 * den Fernsehern sofort sichtbar ist und nicht erst beim naechsten Inhaltswechsel.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole } from '../auth/middleware.js'
import { LANGUAGES, getSettings, setSetting } from '../lib/settings.js'
import { broadcastReload } from '../ws/players.js'
import { Err } from '../lib/errors.js'

export const settingsRoutes = new Hono<AppEnv>()
settingsRoutes.use('*', requireAuth)

settingsRoutes.get('/', async (c) => {
  return c.json({ settings: await getSettings() })
})

const patchSchema = z.object({
  language: z.enum(LANGUAGES).optional(),
})

settingsRoutes.patch('/', requireRole('admin'), async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    throw Err.badRequest(
      `Ungueltige Einstellung. Erlaubt ist z.B. { "language": "${LANGUAGES.join('" | "')}" }.`,
      parsed.error.issues,
    )
  }
  const userId = c.get('user')?.id ?? null
  let changed = false

  if (parsed.data.language) {
    await setSetting('language', parsed.data.language, userId)
    changed = true
  }

  if (!changed) throw Err.badRequest('Keine Einstellung angegeben, es wurde nichts geaendert.')

  // Fernseher haben keine Sitzung: sie holen die Sprache ueber /api/player/content.
  // Ein Reload-Push sorgt dafuer, dass sie sie SOFORT holen.
  broadcastReload('settings')

  return c.json({ settings: await getSettings() })
})
