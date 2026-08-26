/**
 * Beschriftung der Anlage. Kommt aus der Umgebung, nicht aus dem Quelltext, damit
 * dieselbe Fassung unter beliebigem Namen betrieben werden kann.
 *
 * `slug` landet auf den Windows-Geraeten in Pfaden und Aufgabennamen. Ihn nachtraeglich
 * zu aendern bricht bereits installierte Geraete, deshalb wird er streng geprueft.
 */

export interface Brand {
  name: string
  slug: string
  vendor: string
  vendorUrl: string
  vendorEmail: string
}

const DEFAULT_NAME = 'OpenSignage'
const DEFAULT_SLUG = 'OpenSignage'

function clean(v: string | undefined, max: number): string {
  return (v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

function slugify(v: string | undefined): string {
  const raw = (v ?? '').trim()
  if (!raw) return DEFAULT_SLUG
  const safe = raw.replace(/[^A-Za-z0-9]/g, '')
  return safe.length ? safe.slice(0, 32) : DEFAULT_SLUG
}

let cache: Brand | null = null

export function getBrand(): Brand {
  if (cache) return cache
  cache = {
    name: clean(process.env.BRAND_NAME, 60) || DEFAULT_NAME,
    slug: slugify(process.env.BRAND_SLUG),
    vendor: clean(process.env.BRAND_VENDOR, 60),
    vendorUrl: clean(process.env.BRAND_VENDOR_URL, 200),
    vendorEmail: clean(process.env.BRAND_VENDOR_EMAIL, 120),
  }
  return cache
}
