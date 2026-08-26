import { Hono } from 'hono'
import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { displayGroups, displayGroupMembers, displays } from '../db/schema.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole } from '../auth/middleware.js'
import { Err } from '../lib/errors.js'

export const displayGroupRoutes = new Hono<AppEnv>()
displayGroupRoutes.use('*', requireAuth)

displayGroupRoutes.get('/', async (c) => {
  const rows = await db.select({
    id: displayGroups.id,
    name: displayGroups.name,
    description: displayGroups.description,
    createdAt: displayGroups.createdAt,
    memberCount: sql<number>`count(${displayGroupMembers.displayId})::int`,
  })
    .from(displayGroups)
    .leftJoin(displayGroupMembers, eq(displayGroupMembers.groupId, displayGroups.id))
    .groupBy(displayGroups.id)
    .orderBy(desc(displayGroups.createdAt))
  return c.json({ groups: rows })
})

const upsert = z.object({ name: z.string().min(1), description: z.string().nullable().optional() })

displayGroupRoutes.post('/', requireRole('grafik'), async (c) => {
  const p = upsert.safeParse(await c.req.json().catch(() => null))
  if (!p.success) throw Err.badRequest('Ungültige Eingabe: Name ist erforderlich', p.error.issues)
  const row = (await db.insert(displayGroups).values(p.data).returning())[0]
  return c.json({ group: row }, 201)
})

displayGroupRoutes.patch('/:id', requireRole('grafik'), async (c) => {
  const p = upsert.partial().safeParse(await c.req.json().catch(() => null))
  if (!p.success) throw Err.badRequest('Ungültige Eingabe', p.error.issues)
  const row = (await db.update(displayGroups).set(p.data).where(eq(displayGroups.id, c.req.param('id'))).returning())[0]
  if (!row) throw Err.notFound('Gruppe nicht gefunden')
  return c.json({ group: row })
})

displayGroupRoutes.delete('/:id', requireRole('grafik'), async (c) => {
  await db.delete(displayGroups).where(eq(displayGroups.id, c.req.param('id')))
  return c.json({ ok: true })
})

/** Mitglieder (Displays) einer Gruppe. */
displayGroupRoutes.get('/:id/members', async (c) => {
  const rows = await db.select({
    id: displays.id, name: displays.name, status: displays.status, authorized: displays.authorized,
  })
    .from(displayGroupMembers)
    .innerJoin(displays, eq(displays.id, displayGroupMembers.displayId))
    .where(eq(displayGroupMembers.groupId, c.req.param('id')))
  return c.json({ members: rows })
})

displayGroupRoutes.post('/:id/members', requireRole('grafik'), async (c) => {
  const p = z.object({ displayId: z.string().uuid() }).safeParse(await c.req.json().catch(() => null))
  if (!p.success) throw Err.badRequest('displayId (UUID) ist erforderlich')
  await db.insert(displayGroupMembers)
    .values({ groupId: c.req.param('id'), displayId: p.data.displayId })
    .onConflictDoNothing()
  return c.json({ ok: true }, 201)
})

displayGroupRoutes.delete('/:id/members/:displayId', requireRole('grafik'), async (c) => {
  await db.delete(displayGroupMembers).where(
    sql`${displayGroupMembers.groupId} = ${c.req.param('id')} and ${displayGroupMembers.displayId} = ${c.req.param('displayId')}`,
  )
  return c.json({ ok: true })
})
