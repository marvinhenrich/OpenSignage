import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { auditLog, users } from '../db/schema.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole } from '../auth/middleware.js'

export const auditRoutes = new Hono<AppEnv>()
auditRoutes.use('*', requireAuth, requireRole('admin'))

auditRoutes.get('/', async (c) => {
  const limit = Math.min(500, Number(c.req.query('limit') ?? 200))
  const entity = c.req.query('entity')

  const where = entity ? eq(auditLog.entity, entity) : undefined
  const rows = await db.select({
    id: auditLog.id,
    action: auditLog.action,
    entity: auditLog.entity,
    entityId: auditLog.entityId,
    detail: auditLog.detail,
    createdAt: auditLog.createdAt,
    username: users.username,
  })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(where ? and(where) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)

  return c.json({ entries: rows })
})
