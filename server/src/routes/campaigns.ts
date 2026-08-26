import { Hono } from 'hono'
import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { campaigns, campaignLayouts, layouts } from '../db/schema.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole, currentUser } from '../auth/middleware.js'
import { broadcastReload } from '../ws/players.js'
import { Err } from '../lib/errors.js'

export const campaignRoutes = new Hono<AppEnv>()
campaignRoutes.use('*', requireAuth)

campaignRoutes.get('/', async (c) => {
  const rows = await db.select({
    id: campaigns.id,
    name: campaigns.name,
    createdAt: campaigns.createdAt,
    layoutCount: sql<number>`count(${campaignLayouts.layoutId})::int`,
  })
    .from(campaigns)
    .leftJoin(campaignLayouts, eq(campaignLayouts.campaignId, campaigns.id))
    .groupBy(campaigns.id)
    .orderBy(desc(campaigns.createdAt))
  return c.json({ campaigns: rows })
})

campaignRoutes.get('/:id', async (c) => {
  const cmp = (await db.select().from(campaigns).where(eq(campaigns.id, c.req.param('id'))).limit(1))[0]
  if (!cmp) throw Err.notFound('Kampagne nicht gefunden')
  const rows = await db.select({
    layoutId: campaignLayouts.layoutId,
    orderIndex: campaignLayouts.orderIndex,
    name: layouts.name,
    status: layouts.status,
  })
    .from(campaignLayouts)
    .innerJoin(layouts, eq(layouts.id, campaignLayouts.layoutId))
    .where(eq(campaignLayouts.campaignId, cmp.id))
    .orderBy(asc(campaignLayouts.orderIndex))
  return c.json({ campaign: { ...cmp, layouts: rows } })
})

campaignRoutes.post('/', requireRole('grafik'), async (c) => {
  const p = z.object({ name: z.string().min(1) }).safeParse(await c.req.json().catch(() => null))
  if (!p.success) throw Err.badRequest('Ungültige Eingabe: Name ist erforderlich')
  const row = (await db.insert(campaigns).values({ name: p.data.name, ownerId: currentUser(c).id }).returning())[0]
  return c.json({ campaign: row }, 201)
})

campaignRoutes.patch('/:id', requireRole('grafik'), async (c) => {
  const p = z.object({ name: z.string().min(1) }).safeParse(await c.req.json().catch(() => null))
  if (!p.success) throw Err.badRequest('Ungültige Eingabe')
  const row = (await db.update(campaigns).set({ name: p.data.name }).where(eq(campaigns.id, c.req.param('id'))).returning())[0]
  if (!row) throw Err.notFound('Kampagne nicht gefunden')
  return c.json({ campaign: row })
})

campaignRoutes.delete('/:id', requireRole('grafik'), async (c) => {
  await db.delete(campaigns).where(eq(campaigns.id, c.req.param('id')))
  return c.json({ ok: true })
})

/** Geordnete Layout-Liste der Kampagne setzen (ersetzt bestehende). */
campaignRoutes.put('/:id/layouts', requireRole('grafik'), async (c) => {
  const p = z.object({ layoutIds: z.array(z.string().uuid()) }).safeParse(await c.req.json().catch(() => null))
  if (!p.success) throw Err.badRequest('layoutIds (Array von UUIDs) ist erforderlich')
  const id = c.req.param('id')
  const cmp = (await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1))[0]
  if (!cmp) throw Err.notFound('Kampagne nicht gefunden')

  // Existenz der Layouts prüfen
  if (p.data.layoutIds.length) {
    const found = await db.select({ id: layouts.id }).from(layouts).where(inArray(layouts.id, p.data.layoutIds))
    if (found.length !== new Set(p.data.layoutIds).size) throw Err.badRequest('Mindestens ein Layout existiert nicht')
  }

  await db.delete(campaignLayouts).where(eq(campaignLayouts.campaignId, id))
  if (p.data.layoutIds.length) {
    await db.insert(campaignLayouts).values(p.data.layoutIds.map((layoutId, i) => ({ campaignId: id, layoutId, orderIndex: i })))
  }
  broadcastReload('campaign-changed')
  return c.json({ ok: true })
})
