import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { sessions, users } from '../db/schema.js'
import { verifyPassword } from '../lib/password.js'
import { authenticateAD } from '../lib/ad.js'
import { writeAudit } from '../lib/audit.js'
import {
  SESSION_COOKIE, SESSION_TTL_DAYS, hashToken, newSessionToken, sessionExpiry,
} from '../lib/session.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, currentUser } from '../auth/middleware.js'

export const authRoutes = new Hono<AppEnv>()

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

authRoutes.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe' }, 400)
  const { username, password } = parsed.data

  const row = (await db.select().from(users).where(eq(users.username, username)).limit(1))[0]
  if (!row || !row.isActive) return c.json({ error: 'Benutzername oder Passwort falsch' }, 401)

  let ok = false
  if (row.authSource === 'ad') {
    // Passwort wird gegen das Active Directory geprüft (LDAP-Bind)
    const r = await authenticateAD(username, password)
    if (!r.ok && r.reason === 'unreachable') {
      console.error('[auth] AD nicht erreichbar:', r.detail)
      return c.json({ error: 'Active Directory nicht erreichbar' }, 503)
    }
    ok = r.ok
  } else {
    ok = !!row.passwordHash && (await verifyPassword(password, row.passwordHash))
  }
  if (!ok) {
    await writeAudit(null, 'login-fehlgeschlagen', 'auth', null, { username, source: row.authSource })
    return c.json({ error: 'Benutzername oder Passwort falsch' }, 401)
  }

  const token = newSessionToken()
  await db.insert(sessions).values({
    userId: row.id,
    tokenHash: hashToken(token),
    userAgent: c.req.header('user-agent') ?? null,
    ip: c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for') ?? null,
    expiresAt: sessionExpiry(),
  })
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id))

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
  await writeAudit(row.id, 'login', 'auth', row.id, { username: row.username, source: row.authSource })
  return c.json({ user: { id: row.id, username: row.username, role: row.role } })
})

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

authRoutes.get('/me', requireAuth, (c) => {
  return c.json({ user: currentUser(c) })
})
