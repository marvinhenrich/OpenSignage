/**
 * Medien-Storage auf dem Dateisystem (Volume MEDIA_DIR).
 * Ablage: <MEDIA_DIR>/<jahr>/<uuid>.<ext>  — der storage_key ist der relative Pfad.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'

export const MEDIA_DIR = process.env.MEDIA_DIR ?? '/data/media'

export interface StoredFile {
  storageKey: string
  md5: string
  sizeBytes: number
}

/**
 * Erlaubte Dateiendungen. Die Endung wird NIE ungeprueft vom Client uebernommen:
 * sonst laesst sich eine .html hochladen (als Bild deklariert) und liegt danach unter
 * /media/ auf der CMS-Domain - das waere gespeichertes Cross-Site-Scripting.
 */
const SAFE_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg',
  '.mp4', '.webm', '.mov', '.m4v',
  '.mp3', '.wav', '.ogg', '.m4a', '.aac',
  '.pdf', '.ttf', '.otf', '.woff', '.woff2',
])

export async function storeFile(buffer: Buffer, originalName: string, forcedExt?: string): Promise<StoredFile> {
  const year = String(new Date().getUTCFullYear())
  const raw = (forcedExt ?? extname(originalName) ?? '').toLowerCase()
  const ext = SAFE_EXT.has(raw) ? raw : '.bin'
  const storageKey = join(year, `${randomUUID()}${ext}`)
  const abs = join(MEDIA_DIR, storageKey)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, buffer)
  const md5 = createHash('md5').update(buffer).digest('hex')
  return { storageKey, md5, sizeBytes: buffer.length }
}

export async function deleteFile(storageKey: string): Promise<void> {
  try {
    await unlink(join(MEDIA_DIR, storageKey))
  } catch {
    /* Datei evtl. schon weg — ignorieren */
  }
}

export function mediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'pdf' | 'font' | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('font/') || mime === 'application/font-woff') return 'font'
  return null
}
