/**
 * Sofort-Einblendung / Notfall-Overlay: schiebt eine Vollbild-Meldung sofort auf
 * ausgewählte Displays/Gruppen/alle. Hat im Player Vorrang vor Zeitplan/Standard.
 */
import { Hono } from 'hono'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { displays, displayGroupMembers } from '../db/schema.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole } from '../auth/middleware.js'
import { pushToDisplay } from '../ws/players.js'
import { Err } from '../lib/errors.js'

export const emergencyRoutes = new Hono<AppEnv>()
emergencyRoutes.use('*', requireAuth)

const targetSchema = z.object({
  all: z.boolean().optional(),
  displayIds: z.array(z.string().uuid()).optional(),
  groupIds: z.array(z.string().uuid()).optional(),
})

async function resolveTargets(t: z.infer<typeof targetSchema>): Promise<string[]> {
  const ids = new Set<string>()
  if (t.all) {
    (await db.select({ id: displays.id }).from(displays)).forEach((d) => ids.add(d.id))
    return [...ids]
  }
  if (t.displayIds?.length) t.displayIds.forEach((id) => ids.add(id))
  if (t.groupIds?.length) {
    const rows = await db.select({ id: displayGroupMembers.displayId }).from(displayGroupMembers)
      .where(inArray(displayGroupMembers.groupId, t.groupIds))
    rows.forEach((r) => ids.add(r.id))
  }
  return [...ids]
}

const setSchema = z.object({
  targets: targetSchema,
  text: z.string().min(1),
  subtext: z.string().optional(),
  color: z.string().optional(),
  background: z.string().optional(),
  until: z.string().datetime().nullable().optional(),
})

emergencyRoutes.post('/', requireRole('grafik'), async (c) => {
  const p = setSchema.safeParse(await c.req.json().catch(() => null))
  if (!p.success) throw Err.badRequest('Bitte eine Meldung und ein Ziel angeben', p.error.issues)
  const ids = await resolveTargets(p.data.targets)
  if (ids.length === 0) throw Err.badRequest('Kein Zieldisplay gefunden')

  const override = {
    text: p.data.text, subtext: p.data.subtext ?? null,
    color: p.data.color ?? '#ffffff', background: p.data.background ?? '#b91c1c',
    until: p.data.until ?? null,
  }
  await db.update(displays).set({ override, updatedAt: new Date() }).where(inArray(displays.id, ids))
  ids.forEach((id) => pushToDisplay(id, { type: 'reload', reason: 'emergency', ts: Date.now() }))
  return c.json({ ok: true, count: ids.length })
})

emergencyRoutes.post('/clear', requireRole('grafik'), async (c) => {
  const p = z.object({ targets: targetSchema }).safeParse(await c.req.json().catch(() => null))
  const targets = p.success ? p.data.targets : { all: true }
  const ids = targets.all || targets.displayIds?.length || targets.groupIds?.length
    ? await resolveTargets(targets)
    : (await db.select({ id: displays.id }).from(displays)).map((d) => d.id)
  await db.update(displays).set({ override: null, updatedAt: new Date() }).where(inArray(displays.id, ids))
  ids.forEach((id) => pushToDisplay(id, { type: 'reload', reason: 'emergency-clear', ts: Date.now() }))
  return c.json({ ok: true, count: ids.length })
})

/** Anzahl Displays mit aktiver Einblendung (für UI-Anzeige). */
emergencyRoutes.get('/active', async (c) => {
  const rows = await db.select({ id: displays.id, name: displays.name, override: displays.override }).from(displays)
  const active = rows.filter((r) => r.override && (r.override as any).text)
  return c.json({ active: active.map((a) => ({ id: a.id, name: a.name, text: (a.override as any).text })) })
})
