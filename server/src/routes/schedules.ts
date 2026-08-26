import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { schedules, layouts, campaigns, displays, displayGroups } from '../db/schema.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole, currentUser } from '../auth/middleware.js'
import { broadcastReload } from '../ws/players.js'
import { Err } from '../lib/errors.js'

export const scheduleRoutes = new Hono<AppEnv>()
scheduleRoutes.use('*', requireAuth)

/** Zeitpläne inkl. Namen von Inhalt (Layout/Kampagne) und Ziel (Display/Gruppe) — für den Kalender. */
scheduleRoutes.get('/', async (c) => {
  const rows = await db.select({
    id: schedules.id, name: schedules.name, type: schedules.type,
    layoutId: schedules.layoutId, campaignId: schedules.campaignId,
    displayId: schedules.displayId, displayGroupId: schedules.displayGroupId,
    fromDt: schedules.fromDt, toDt: schedules.toDt, priority: schedules.priority,
    isOverlay: schedules.isOverlay, recurrence: schedules.recurrence,
    layoutName: layouts.name, campaignName: campaigns.name,
    displayName: displays.name, groupName: displayGroups.name,
  })
    .from(schedules)
    .leftJoin(layouts, eq(layouts.id, schedules.layoutId))
    .leftJoin(campaigns, eq(campaigns.id, schedules.campaignId))
    .leftJoin(displays, eq(displays.id, schedules.displayId))
    .leftJoin(displayGroups, eq(displayGroups.id, schedules.displayGroupId))
    .orderBy(desc(schedules.fromDt))
  return c.json({ schedules: rows })
})

const upsertSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['layout', 'campaign', 'overlay', 'command']).default('layout'),
  layoutId: z.string().uuid().nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
  displayId: z.string().uuid().nullable().optional(),
  displayGroupId: z.string().uuid().nullable().optional(),
  fromDt: z.string().datetime(),
  toDt: z.string().datetime().nullable().optional(),
  priority: z.number().int().default(0),
  isOverlay: z.boolean().default(false),
  recurrence: z.record(z.unknown()).nullable().optional(),
})

scheduleRoutes.post('/', requireRole('grafik'), async (c) => {
  const parsed = upsertSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw Err.badRequest('Ungültige Eingabe', parsed.error.issues)
  const d = parsed.data
  if (!d.displayId && !d.displayGroupId) {
    throw Err.badRequest('Ziel fehlt: bitte ein Display oder eine Gruppe wählen')
  }
  if (d.type === 'layout' && !d.layoutId) throw Err.badRequest('Bitte ein Layout wählen')
  if (d.type === 'campaign' && !d.campaignId) throw Err.badRequest('Bitte eine Kampagne wählen')
  const row = (await db.insert(schedules).values({
    name: d.name,
    type: d.type,
    layoutId: d.layoutId ?? null,
    campaignId: d.campaignId ?? null,
    displayId: d.displayId ?? null,
    displayGroupId: d.displayGroupId ?? null,
    fromDt: new Date(d.fromDt),
    toDt: d.toDt ? new Date(d.toDt) : null,
    priority: d.priority,
    isOverlay: d.isOverlay,
    recurrence: d.recurrence ?? null,
    createdBy: currentUser(c).id,
  }).returning())[0]
  broadcastReload('schedule-changed')
  return c.json({ schedule: row }, 201)
})

scheduleRoutes.delete('/:id', requireRole('grafik'), async (c) => {
  await db.delete(schedules).where(eq(schedules.id, c.req.param('id')))
  broadcastReload('schedule-changed')
  return c.json({ ok: true })
})
