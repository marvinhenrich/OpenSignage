/** Gemeinsame Layout-Baum-Auflösung: Layout → Regionen → Playlist → Widgets. */
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { layouts, regions, playlists, widgets, media } from '../db/schema.js'

export async function getLayoutTree(id: string) {
  const layout = (await db.select().from(layouts).where(eq(layouts.id, id)).limit(1))[0]
  if (!layout) return null
  const regs = await db.select().from(regions).where(eq(regions.layoutId, id)).orderBy(asc(regions.zIndex))
  const regIds = regs.map((r) => r.id)
  const pls = regIds.length ? await db.select().from(playlists).where(inArray(playlists.regionId, regIds)) : []
  const plIds = pls.map((p) => p.id)
  const wgs = plIds.length
    ? await db.select().from(widgets).where(inArray(widgets.playlistId, plIds)).orderBy(asc(widgets.orderIndex))
    : []

  // Medien-Infos (storageKey/type) für Medien-Widgets nachladen — der Player braucht die URL.
  const mediaIds = [...new Set(wgs.map((w) => w.mediaId).filter((x): x is string => !!x))]
  const meds = mediaIds.length ? await db.select().from(media).where(inArray(media.id, mediaIds)) : []
  const medById = new Map(meds.map((m) => [m.id, m]))

  const enrich = (w: typeof wgs[number]) => {
    const m = w.mediaId ? medById.get(w.mediaId) : undefined
    return { ...w, mediaStorageKey: m?.storageKey ?? null, mediaType: m?.type ?? null, mediaMime: m?.mimeType ?? null }
  }

  return {
    ...layout,
    regions: regs.map((r) => {
      const pl = pls.find((p) => p.regionId === r.id) ?? null
      return {
        ...r,
        playlist: pl ? { ...pl, widgets: wgs.filter((w) => w.playlistId === pl.id).map(enrich) } : null,
      }
    }),
  }
}
