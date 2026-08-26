/**
 * Auth-Middleware: liest das Session-Cookie, validiert die Session in der DB
 * und legt den Benutzer im Context ab. requireAuth / requireRole schützen Routen.
 */
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '../db/index.js'
import { sessions, users } from '../db/schema.js'
import { SESSION_COOKIE, hashToken } from '../lib/session.js'

export type AuthUser = {
  id: string
  username: string
  role: 'admin' | 'operator' | 'viewer' | 'grafik'
}

export type AppEnv = { Variables: { user: AuthUser | null } }

/** Lädt den Benutzer (falls gültige Session) in den Context — blockt nicht. */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', null)
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const rows = await db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1)
    if (rows[0]) c.set('user', rows[0] as AuthUser)
  }
  await next()
}

/** 401, wenn nicht eingeloggt. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'Nicht angemeldet' }, 401)
  await next()
}

/** 403, wenn Rolle nicht ausreicht (admin > operator > viewer). */
export function requireRole(min: AuthUser['role']): MiddlewareHandler<AppEnv> {
  const rank = { viewer: 0, operator: 1, grafik: 1, admin: 2 }
  return async (c, next) => {
    const u = c.get('user')
    if (!u) return c.json({ error: 'Nicht angemeldet' }, 401)
    if (rank[u.role] < rank[min]) return c.json({ error: 'Keine Berechtigung' }, 403)
    await next()
  }
}

export function currentUser(c: Context<AppEnv>): AuthUser {
  return c.get('user') as AuthUser
}

/** Nutzer aus einem rohen Cookie-Header auflösen (für WebSocket-Handshakes). */
export async function userFromCookieHeader(cookieHeader?: string): Promise<AuthUser | null> {
  if (!cookieHeader) return null
  const match = cookieHeader.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${SESSION_COOKIE}=`))
  if (!match) return null
  const token = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1))
  const rows = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1)
  return (rows[0] as AuthUser) ?? null
}
