import { Hono } from 'hono'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole, currentUser } from '../auth/middleware.js'

export const userRoutes = new Hono<AppEnv>()
userRoutes.use('*', requireAuth)

const pub = { id: users.id, username: users.username, email: users.email, role: users.role, authSource: users.authSource, isActive: users.isActive, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt }

userRoutes.get('/', requireRole('admin'), async (c) => {
  const rows = await db.select(pub).from(users).orderBy(desc(users.createdAt))
  return c.json({ users: rows })
})

const createSchema = z.object({
  username: z.string().min(1),
  role: z.enum(['admin', 'grafik']).default('grafik'),
  authSource: z.enum(['local', 'ad']).default('ad'),
  email: z.string().email().nullable().optional(),
  password: z.string().min(8).optional(),   // nur für authSource=local
})

userRoutes.post('/', requireRole('admin'), async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe', detail: parsed.error.issues }, 400)
  const d = parsed.data
  if (d.authSource === 'local' && !d.password) {
    return c.json({ error: 'Für lokale Nutzer ist ein Passwort (min. 8 Zeichen) nötig' }, 400)
  }
  const exists = (await db.select({ id: users.id }).from(users).where(eq(users.username, d.username)).limit(1))[0]
  if (exists) return c.json({ error: 'Benutzername existiert bereits' }, 409)

  const row = (await db.insert(users).values({
    username: d.username,
    email: d.email ?? null,
    role: d.role,
    authSource: d.authSource,
    passwordHash: d.authSource === 'local' ? await hashPassword(d.password!) : null,
  }).returning(pub))[0]
  return c.json({ user: row }, 201)
})

userRoutes.delete('/:id', requireRole('admin'), async (c) => {
  const id = c.req.param('id')
  if (id === currentUser(c).id) return c.json({ error: 'Eigenen Account nicht löschbar' }, 400)
  // Letzten aktiven Admin schützen
  const admins = (await db.select({ n: sql<number>`count(*)::int` }).from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, id))))[0]?.n ?? 0
  const target = (await db.select({ role: users.role }).from(users).where(eq(users.id, id)).limit(1))[0]
  if (target?.role === 'admin' && admins === 0) return c.json({ error: 'Der letzte Admin kann nicht gelöscht werden' }, 400)
  await db.delete(users).where(eq(users.id, id))
  return c.json({ ok: true })
})

/** Eigenes Passwort ändern (nur lokale Konten). */
const pwSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
userRoutes.post('/me/password', async (c) => {
  const parsed = pwSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Neues Passwort min. 8 Zeichen' }, 400)
  const me = (await db.select().from(users).where(eq(users.id, currentUser(c).id)).limit(1))[0]
  if (!me || me.authSource !== 'local' || !me.passwordHash) {
    return c.json({ error: 'Passwortänderung nur für lokale Konten möglich' }, 400)
  }
  if (!(await verifyPassword(parsed.data.currentPassword, me.passwordHash))) {
    return c.json({ error: 'Aktuelles Passwort falsch' }, 401)
  }
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.newPassword), updatedAt: new Date() })
    .where(eq(users.id, me.id))
  return c.json({ ok: true })
})
