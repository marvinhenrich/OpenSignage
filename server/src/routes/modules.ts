/**
 * Module lesen und schalten.
 *
 *   GET   /api/modules        — jeder angemeldete Benutzer (die Oberflaeche
 *                               blendet abgeschaltete Bereiche aus)
 *   PATCH /api/modules/:id    — NUR Rolle admin
 *
 * Abschalten wirkt sofort: die Player bekommen ein `reload` ueber den
 * bestehenden Kanal, damit ein abgeschaltetes Widget nicht bis zum naechsten
 * Inhaltswechsel weiterlaeuft.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole } from '../auth/middleware.js'
import { modulListe, setzeModul, abhaengigeVon } from '../lib/modules.js'
import { broadcastReload } from '../ws/players.js'
import { Err } from '../lib/errors.js'

export const moduleRoutes = new Hono<AppEnv>()
moduleRoutes.use('*', requireAuth)

moduleRoutes.get('/', async (c) => c.json({ module: await modulListe() }))

const patchSchema = z.object({ aktiv: z.boolean() })

moduleRoutes.patch('/:id', requireRole('admin'), async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    throw Err.badRequest('Erwartet wird { "aktiv": true } oder { "aktiv": false }.', parsed.error.issues)
  }
  const id = c.req.param('id')
  const liste = await modulListe()
  const def = liste.find((m) => m.id === id)
  if (!def) throw Err.badRequest(`Unbekanntes Modul: ${id}.`)

  await setzeModul(id, parsed.data.aktiv, c.get('user')?.id ?? null)
  broadcastReload('module')

  // Beim Abschalten mitteilen, was dadurch ebenfalls stillsteht - sonst sucht
  // jemand spaeter, warum ein ganz anderer Bereich leer ist.
  const mitbetroffen = parsed.data.aktiv ? [] : abhaengigeVon(id).map((m) => m.name)
  return c.json({ module: await modulListe(), mitbetroffen })
})
