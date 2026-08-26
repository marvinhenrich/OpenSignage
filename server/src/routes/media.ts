import { Hono } from 'hono'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { media, widgets } from '../db/schema.js'
import { storeFile, deleteFile, mediaTypeFromMime } from '../lib/storage.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole, currentUser } from '../auth/middleware.js'
import { Err } from '../lib/errors.js'

export const mediaRoutes = new Hono<AppEnv>()
mediaRoutes.use('*', requireAuth)

mediaRoutes.get('/', async (c) => {
  const rows = await db.select({
    id: media.id, name: media.name, type: media.type, storageKey: media.storageKey,
    mimeType: media.mimeType, sizeBytes: media.sizeBytes, width: media.width, height: media.height,
    createdAt: media.createdAt,
    usageCount: sql<number>`(select count(*) from ${widgets} where ${widgets.mediaId} = ${media.id})::int`,
  }).from(media).orderBy(desc(media.createdAt))
  return c.json({ media: rows })
})

mediaRoutes.get('/:id', async (c) => {
  const row = (await db.select().from(media).where(eq(media.id, c.req.param('id'))).limit(1))[0]
  if (!row) return c.json({ error: 'Nicht gefunden' }, 404)
  return c.json({ media: row })
})

mediaRoutes.post('/', requireRole('grafik'), async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) return c.json({ error: 'Feld "file" fehlt' }, 400)

  const type = mediaTypeFromMime(file.type)
  if (!type) return c.json({ error: `Nicht unterstützter Typ: ${file.type}` }, 415)

  const buf = Buffer.from(await file.arrayBuffer())
  const stored = await storeFile(buf, file.name)
  const name = (typeof body['name'] === 'string' && body['name']) || file.name

  const row = (await db.insert(media).values({
    name,
    type,
    storageKey: stored.storageKey,
    originalFilename: file.name,
    mimeType: file.type,
    sizeBytes: stored.sizeBytes,
    md5: stored.md5,
    ownerId: currentUser(c).id,
  }).returning())[0]
  return c.json({ media: row }, 201)
})

mediaRoutes.patch('/:id', requireRole('grafik'), async (c) => {
  const body = await c.req.json().catch(() => null)
  const patch: Record<string, unknown> = {}
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (Array.isArray(body?.tags)) patch.tags = body.tags.filter((t: unknown) => typeof t === 'string')
  if (Object.keys(patch).length === 0) return c.json({ error: 'Nichts zu ändern (name oder tags angeben)' }, 400)
  patch.updatedAt = new Date()
  const row = (await db.update(media).set(patch).where(eq(media.id, c.req.param('id'))).returning())[0]
  if (!row) return c.json({ error: 'Nicht gefunden' }, 404)
  return c.json({ media: row })
})

mediaRoutes.delete('/:id', requireRole('grafik'), async (c) => {
  const row = (await db.select().from(media).where(eq(media.id, c.req.param('id'))).limit(1))[0]
  if (!row) return c.json({ error: 'Nicht gefunden' }, 404)
  const used = (await db.select({ n: sql<number>`count(*)::int` }).from(widgets).where(eq(widgets.mediaId, row.id)))[0]?.n ?? 0
  if (used > 0) throw Err.conflict(`Medium wird noch in ${used} Widget${used > 1 ? 's' : ''} verwendet und kann nicht gelöscht werden. Entferne es zuerst aus den Layouts.`)
  await db.delete(media).where(eq(media.id, row.id))
  await deleteFile(row.storageKey)
  return c.json({ ok: true })
})
