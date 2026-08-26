import { Hono } from 'hono'
import { desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { proofOfPlay, media, layouts, displays } from '../db/schema.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth } from '../auth/middleware.js'

export const statsRoutes = new Hono<AppEnv>()
statsRoutes.use('*', requireAuth)

statsRoutes.get('/overview', async (c) => {
  const since7 = new Date(Date.now() - 7 * 86_400_000)
  const since14 = new Date(Date.now() - 14 * 86_400_000)

  const totalPlays = (await db.select({ n: sql<number>`count(*)::int` }).from(proofOfPlay).where(gte(proofOfPlay.startedAt, since7)))[0]?.n ?? 0
  const disp = await db.select({ status: displays.status }).from(displays)
  const mediaAgg = (await db.select({ n: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${media.sizeBytes}),0)::bigint` }).from(media))[0]
  const mediaCount = mediaAgg?.n ?? 0
  const storageBytes = Number(mediaAgg?.bytes ?? 0)
  const layoutsCount = (await db.select({ n: sql<number>`count(*)::int` }).from(layouts))[0]?.n ?? 0

  const playsPerDay = await db.select({
    day: sql<string>`to_char(date_trunc('day', ${proofOfPlay.startedAt}), 'YYYY-MM-DD')`,
    count: sql<number>`count(*)::int`,
  }).from(proofOfPlay).where(gte(proofOfPlay.startedAt, since14)).groupBy(sql`1`).orderBy(sql`1`)

  const topMedia = await db.select({
    name: media.name, count: sql<number>`count(*)::int`,
  }).from(proofOfPlay).innerJoin(media, eq(media.id, proofOfPlay.mediaId))
    .where(gte(proofOfPlay.startedAt, since7)).groupBy(media.name).orderBy(desc(sql`count(*)`)).limit(8)

  const topLayouts = await db.select({
    name: layouts.name, count: sql<number>`count(*)::int`,
  }).from(proofOfPlay).innerJoin(layouts, eq(layouts.id, proofOfPlay.layoutId))
    .where(gte(proofOfPlay.startedAt, since7)).groupBy(layouts.name).orderBy(desc(sql`count(*)`)).limit(8)

  return c.json({
    kpi: {
      playsLast7d: totalPlays,
      displaysTotal: disp.length,
      displaysOnline: disp.filter((d) => d.status === 'online').length,
      mediaCount, layoutsCount, storageBytes,
    },
    playsPerDay,
    topMedia,
    topLayouts,
  })
})
