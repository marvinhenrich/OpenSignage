/**
 * Bausteine der Zweisprachigkeit. Hier stehen nur Typen und ein Helfer —
 * die Laufzeit (Provider/Hook) liegt in `../i18n/index.ts`, die Texte in `./dict/*.ts`.
 * Getrennt, damit ein Woerterbuch NIE den Provider importieren muss (kein Ringschluss).
 */

/** Unterstuetzte Sprachen. Muss zu `server/src/lib/settings.ts` passen. */
export type Lang = 'de' | 'en'

/** Werte fuer Platzhalter im Text, z.B. t('wall.offlineSince', { minutes: 5 }). */
export type Vars = Record<string, string | number>

/** Ein Bereichs-Woerterbuch: Deutsch ist vollstaendig, Englisch darf Luecken haben. */
export interface DictModule<D extends Record<string, string>> {
  de: D
  en: Partial<Record<keyof D, string>>
}

/**
 * Ein Bereichs-Woerterbuch anlegen.
 *
 * Deutsch ist die Referenz: aus dem deutschen Objekt entstehen die gueltigen Schluessel.
 * Das englische Objekt darf nur diese Schluessel benutzen (Tippfehler fallen beim
 * Typecheck auf) und darf Schluessel weglassen — dann greift automatisch der deutsche Text.
 *
 *   export const media = defineDict(
 *     { 'media.title': 'Medien' },
 *     { 'media.title': 'Media' },
 *   )
 */
export function defineDict<D extends Record<string, string>>(
  de: D,
  en: Partial<Record<keyof D, string>>,
): DictModule<D> {
  return { de, en }
}
