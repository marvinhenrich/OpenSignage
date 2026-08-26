import { Hono } from 'hono'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { layouts, regions, playlists, widgets } from '../db/schema.js'
import type { AppEnv } from '../auth/middleware.js'
import { requireAuth, requireRole, currentUser } from '../auth/middleware.js'
import { getLayoutTree } from '../lib/layoutTree.js'
import { broadcastReload } from '../ws/players.js'
import { widgetErlaubt, modulFuerWidget } from '../lib/modules.js'

export const layoutRoutes = new Hono<AppEnv>()
layoutRoutes.use('*', requireAuth)

layoutRoutes.get('/', async (c) => {
  const rows = await db.select().from(layouts).orderBy(desc(layouts.updatedAt))
  return c.json({ layouts: rows })
})

layoutRoutes.get('/:id', async (c) => {
  const tree = await getLayoutTree(c.req.param('id'))
  if (!tree) return c.json({ error: 'Nicht gefunden' }, 404)
  return c.json({ layout: tree })
})

const createSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  backgroundColor: z.string().default('#000000'),
})

layoutRoutes.post('/', requireRole('grafik'), async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe' }, 400)
  const d = parsed.data
  const layout = (await db.insert(layouts).values({
    name: d.name, width: d.width, height: d.height,
    backgroundColor: d.backgroundColor, ownerId: currentUser(c).id,
  }).returning())[0]
  // Standard-Region über die volle Fläche + zugehörige Playlist
  const region = (await db.insert(regions).values({
    layoutId: layout.id, name: 'Vollbild', x: 0, y: 0, width: d.width, height: d.height,
  }).returning())[0]
  await db.insert(playlists).values({ regionId: region.id, name: 'Playlist' })
  const tree = await getLayoutTree(layout.id)
  return c.json({ layout: tree }, 201)
})

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  backgroundColor: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
}).strict()

layoutRoutes.patch('/:id', requireRole('grafik'), async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe' }, 400)
  const id = c.req.param('id')
  const data: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() }

  // Aktuellen Stand holen (fuer publishedVersion + proportionale Skalierung der Regionen)
  const cur = (await db.select({ v: layouts.publishedVersion, w: layouts.width, h: layouts.height })
    .from(layouts).where(eq(layouts.id, id)).limit(1))[0]
  if (!cur) return c.json({ error: 'Nicht gefunden' }, 404)
  if (parsed.data.status === 'published') data.publishedVersion = (cur.v ?? 0) + 1

  const row = (await db.update(layouts).set(data).where(eq(layouts.id, id)).returning())[0]

  // Groessenaenderung: Regionen proportional mitskalieren, damit sie im Verhaeltnis bleiben.
  // (Sonst ragt z.B. eine 1920x1080-Vollbildregion aus einem auf 1280x720 verkleinerten Layout heraus.)
  const rx = parsed.data.width && cur.w ? parsed.data.width / cur.w : 1
  const ry = parsed.data.height && cur.h ? parsed.data.height / cur.h : 1
  if (rx !== 1 || ry !== 1) {
    await db.update(regions).set({
      x: sql`${regions.x} * ${rx}`,
      y: sql`${regions.y} * ${ry}`,
      width: sql`${regions.width} * ${rx}`,
      height: sql`${regions.height} * ${ry}`,
    }).where(eq(regions.layoutId, id))
  }

  // Veröffentlichen -> betroffene Player sofort neu laden lassen
  if (parsed.data.status === 'published') broadcastReload('layout-published')
  return c.json({ layout: row })
})

layoutRoutes.delete('/:id', requireRole('grafik'), async (c) => {
  await db.delete(layouts).where(eq(layouts.id, c.req.param('id')))
  return c.json({ ok: true })
})

/** Layout inkl. Regionen, Playlists und Widgets als „(Kopie)" duplizieren. */
layoutRoutes.post('/:id/duplicate', requireRole('grafik'), async (c) => {
  const src = await getLayoutTree(c.req.param('id'))
  if (!src) return c.json({ error: 'Nicht gefunden' }, 404)
  const nl = (await db.insert(layouts).values({
    name: `${src.name} (Kopie)`, description: src.description, width: src.width, height: src.height,
    backgroundColor: src.backgroundColor, backgroundMediaId: src.backgroundMediaId,
    status: 'draft', ownerId: currentUser(c).id,
  }).returning())[0]

  for (const r of src.regions) {
    const nr = (await db.insert(regions).values({
      layoutId: nl.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height,
      zIndex: r.zIndex, loop: r.loop, transition: r.transition,
    }).returning())[0]
    if (r.playlist) {
      const np = (await db.insert(playlists).values({
        regionId: nr.id, name: r.playlist.name, isDynamic: r.playlist.isDynamic, filter: r.playlist.filter,
      }).returning())[0]
      for (const w of r.playlist.widgets) {
        await db.insert(widgets).values({
          playlistId: np.id, type: w.type, name: w.name, mediaId: w.mediaId,
          durationSeconds: w.durationSeconds, useMediaDuration: w.useMediaDuration,
          orderIndex: w.orderIndex, options: w.options, fromDt: w.fromDt, toDt: w.toDt, enabled: w.enabled,
        })
      }
    }
  }
  const tree = await getLayoutTree(nl.id)
  return c.json({ layout: tree }, 201)
})

// ---- Regionen -------------------------------------------------------------
const regionSchema = z.object({
  name: z.string().optional(),
  x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(),
  zIndex: z.number().int().optional(), loop: z.boolean().optional(), transition: z.string().optional(),
})

layoutRoutes.post('/:id/regions', requireRole('grafik'), async (c) => {
  const parsed = regionSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe' }, 400)
  const region = (await db.insert(regions).values({
    layoutId: c.req.param('id'), ...parsed.data,
  }).returning())[0]
  await db.insert(playlists).values({ regionId: region.id, name: 'Playlist' })
  return c.json({ region }, 201)
})

layoutRoutes.patch('/regions/:rid', requireRole('grafik'), async (c) => {
  const parsed = regionSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe' }, 400)
  const row = (await db.update(regions).set(parsed.data).where(eq(regions.id, c.req.param('rid'))).returning())[0]
  if (!row) return c.json({ error: 'Nicht gefunden' }, 404)
  return c.json({ region: row })
})

layoutRoutes.delete('/regions/:rid', requireRole('grafik'), async (c) => {
  await db.delete(regions).where(eq(regions.id, c.req.param('rid')))
  return c.json({ ok: true })
})

// ---- Widgets --------------------------------------------------------------
const widgetSchema = z.object({
  type: z.enum(['image', 'video', 'audio', 'pdf', 'text', 'clock', 'weather', 'rss', 'webpage', 'embedded_html', 'icinga']),
  name: z.string().nullable().optional(),
  mediaId: z.string().uuid().nullable().optional(),
  durationSeconds: z.number().int().positive().default(10),
  useMediaDuration: z.boolean().optional(),
  options: z.record(z.unknown()).optional(),
})

/** Widget an die Playlist einer Region anhängen. */
layoutRoutes.post('/regions/:rid/widgets', requireRole('grafik'), async (c) => {
  const parsed = widgetSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe' }, 400)
  // Monitoring ist IT-Sache: das Icinga-Widget duerfen nur Admins einsetzen (nicht Grafiker).
  if (parsed.data.type === 'icinga' && currentUser(c)?.role !== 'admin') {
    return c.json({ error: 'Das Icinga-Widget dürfen nur Administratoren verwenden.' }, 403)
  }
  // Abgeschaltete Module sind auch serverseitig zu. Nur auszublenden reicht
  // nicht: die Oberflaeche ist nicht die Sicherheitsgrenze.
  if (!(await widgetErlaubt(parsed.data.type))) {
    const m = modulFuerWidget(parsed.data.type)
    return c.json({
      error: `Dieser Inhaltstyp ist in dieser Installation abgeschaltet${m ? ` (Modul „${m.name}“)` : ''}.`,
      code: 'MODULE_DISABLED',
    }, 403)
  }
  const pl = (await db.select().from(playlists).where(eq(playlists.regionId, c.req.param('rid'))).limit(1))[0]
  if (!pl) return c.json({ error: 'Region/Playlist nicht gefunden' }, 404)
  const last = (await db.select({ o: widgets.orderIndex }).from(widgets)
    .where(eq(widgets.playlistId, pl.id)).orderBy(desc(widgets.orderIndex)).limit(1))[0]
  const row = (await db.insert(widgets).values({
    playlistId: pl.id,
    type: parsed.data.type,
    name: parsed.data.name ?? null,
    mediaId: parsed.data.mediaId ?? null,
    durationSeconds: parsed.data.durationSeconds,
    useMediaDuration: parsed.data.useMediaDuration ?? false,
    options: parsed.data.options ?? {},
    orderIndex: (last?.o ?? -1) + 1,
  }).returning())[0]
  return c.json({ widget: row }, 201)
})

layoutRoutes.patch('/widgets/:wid', requireRole('grafik'), async (c) => {
  const parsed = widgetSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe' }, 400)
  const row = (await db.update(widgets).set(parsed.data).where(eq(widgets.id, c.req.param('wid'))).returning())[0]
  if (!row) return c.json({ error: 'Nicht gefunden' }, 404)
  return c.json({ widget: row })
})

layoutRoutes.delete('/widgets/:wid', requireRole('grafik'), async (c) => {
  await db.delete(widgets).where(eq(widgets.id, c.req.param('wid')))
  return c.json({ ok: true })
})

/** Reihenfolge der Widgets in einer Playlist setzen (Array von Widget-IDs). */
layoutRoutes.post('/regions/:rid/widgets/reorder', requireRole('grafik'), async (c) => {
  const parsed = z.object({ order: z.array(z.string().uuid()) }).safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Ungültige Eingabe' }, 400)
  const pl = (await db.select().from(playlists).where(eq(playlists.regionId, c.req.param('rid'))).limit(1))[0]
  if (!pl) return c.json({ error: 'Region/Playlist nicht gefunden' }, 404)
  for (let i = 0; i < parsed.data.order.length; i++) {
    await db.update(widgets).set({ orderIndex: i })
      .where(and(eq(widgets.id, parsed.data.order[i]), eq(widgets.playlistId, pl.id)))
  }
  return c.json({ ok: true })
})
