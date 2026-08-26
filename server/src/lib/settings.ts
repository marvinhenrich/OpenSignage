/**
 * Organisationsweite Einstellungen (Tabelle `app_settings`).
 *
 * Die Sprache der Oberflaeche ist eine Einstellung der INSTALLATION, nicht des Benutzers
 * und nicht des Browsers: ein Admin stellt sie einmal um, danach sehen alle Benutzer und
 * alle Displays dieselbe Sprache. Deutsch ist Standard und bleibt die Referenz.
 *
 * Warum der kleine Zwischenspeicher: `/api/player/content` wird von jedem Display
 * regelmaessig abgerufen und haengt die Sprache an. Ohne Cache waere das je Abruf eine
 * zusaetzliche Abfrage auf einem Pool mit nur 10 Verbindungen. Beim Schreiben wird der
 * Zwischenspeicher sofort verworfen, die Umstellung wirkt also ohne Verzoegerung.
 */
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { appSettings } from '../db/schema.js'

/** Unterstuetzte Sprachen. Muss zu `admin/src/i18n` passen. */
export const LANGUAGES = ['de', 'en'] as const
export type AppLanguage = (typeof LANGUAGES)[number]

/** Deutsch ist die Standardsprache und die Referenz. */
export const DEFAULT_LANGUAGE: AppLanguage = 'de'

/** Alle Einstellungen, die die Oberflaeche kennt — mit garantierten Standardwerten. */
export interface AppSettings {
  language: AppLanguage
}

const CACHE_MS = 30_000
let cache: { at: number; value: AppSettings } | null = null

function isLanguage(v: unknown): v is AppLanguage {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v)
}

/** Zwischenspeicher verwerfen — nach jedem Schreibvorgang aufrufen. */
export function invalidateSettingsCache(): void {
  cache = null
}

/**
 * Alle Einstellungen lesen. Fehlende oder unbekannte Werte fallen still auf den
 * Standard zurueck: eine per Hand verdrehte Zeile in der Tabelle darf die Oberflaeche
 * nicht lahmlegen.
 */
export async function getSettings(): Promise<AppSettings> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.value
  const rows = await db.select().from(appSettings)
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const lang = map.get('language')
  const value: AppSettings = { language: isLanguage(lang) ? lang : DEFAULT_LANGUAGE }
  cache = { at: now, value }
  return value
}

/** Nur die Sprache — der haeufigste Zugriff (Player-Inhalt). */
export async function getLanguage(): Promise<AppLanguage> {
  return (await getSettings()).language
}

/** Einen Wert setzen (Upsert). Nur von der Einstellungen-Route aufrufen (Rolle admin). */
export async function setSetting(key: keyof AppSettings, value: string, userId: string | null): Promise<void> {
  await db.insert(appSettings)
    .values({ key, value, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy: userId, updatedAt: new Date() },
    })
  invalidateSettingsCache()
}

/** Nur zum Aufraeumen/Test: einzelnen Wert roh lesen. */
export async function getRawSetting(key: string): Promise<string | null> {
  const row = (await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1))[0]
  return row?.value ?? null
}
