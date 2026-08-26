/**
 * Audit-Middleware: protokolliert JEDE verändernde API-Aktion (POST/PUT/PATCH/DELETE)
 * lückenlos in audit_log — wer (userId), was (Methode), Objekt (entity/entityId),
 * Ergebnis (status). Keine Request-Bodies (keine Passwörter/Secrets im Log).
 */
import type { MiddlewareHandler } from 'hono'
import { db } from '../db/index.js'
import { auditLog } from '../db/schema.js'
import type { AppEnv } from '../auth/middleware.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MUT = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Expliziter Audit-Eintrag (z. B. Login/Logout, wo der Nutzer erst im Handler feststeht). */
export async function writeAudit(
  userId: string | null, action: string, entity: string, entityId: string | null, detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLog).values({ userId, action, entity, entityId, detail: detail ?? null })
  } catch (err) {
    console.error('[audit] konnte Eintrag nicht schreiben:', err)
  }
}

export const auditMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  const method = c.req.method
  if (!MUT.has(method)) return
  const path = c.req.path
  if (!path.startsWith('/api/')) return

  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  const entity = parts[0] ?? 'unbekannt'
  const entityId = parts.find((p) => UUID_RE.test(p)) ?? null
  const sub = parts.slice(1).filter((p) => !UUID_RE.test(p)).join('/') // z.B. "authorize", "members"

  try {
    await db.insert(auditLog).values({
      userId: c.get('user')?.id ?? null,
      action: sub ? `${method} ${sub}` : method,
      entity,
      entityId,
      detail: { path, method, status: c.res.status },
    })
  } catch (err) {
    console.error('[audit] konnte Eintrag nicht schreiben:', err)
  }
}
