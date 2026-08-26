/**
 * Zweisprachigkeit (Deutsch/Englisch) — schlanker Eigenbau, BEWUSST ohne Fremdbibliothek.
 *
 * Grundsaetze
 * -----------
 * • Die Sprache ist eine Einstellung der INSTALLATION, nicht des Benutzers und nicht des
 *   Browsers: ein Admin stellt sie unter „Einstellungen" um, danach sehen alle Benutzer und
 *   alle Displays dieselbe Sprache (Server: `app_settings.language`, `GET/PATCH /api/settings`).
 * • Deutsch ist Standard UND Referenz. Fehlt ein englischer Text, erscheint der deutsche —
 *   nie ein leerer String, nie ein roher Schluessel.
 * • Der Fernseher hat keine Sitzung: seine Sprache reist an `GET /api/player/content` mit
 *   und wird mit `applyLang()` gesetzt (kein Schreibzugriff auf die Einstellung).
 *
 * So kommt ein neuer Bereich dazu (bitte genau so, damit mehrere parallel arbeiten koennen)
 * ---------------------------------------------------------------------------------------
 *   1. `admin/src/i18n/dict/<bereich>.ts` anlegen:
 *
 *        import { defineDict } from '../types'
 *        export const editor = defineDict(
 *          { 'editor.publish': 'Veröffentlichen' },   // Deutsch = vollstaendig, Referenz
 *          { 'editor.publish': 'Publish' },           // Englisch = darf Luecken haben
 *        )
 *
 *   2. Hier unten importieren und in BEIDE Sammel-Objekte einhaengen (zwei Zeilen).
 *   3. In der Seite benutzen:
 *
 *        const t = useT()
 *        <Button>{t('editor.publish')}</Button>
 *        <p>{t('wall.offlineSince', { minutes: 5 })}</p>
 *
 * Schluessel sind FLACH und tragen immer ihr Bereichspraefix (`editor.publish`,
 * `wall.offlineSince`). Platzhalter stehen in geschweiften Klammern (`{count}`); ein
 * Platzhalter ohne Wert bleibt sichtbar stehen, damit die Luecke auffaellt statt zu schweigen.
 * Zahlen und Datumsangaben NICHT fest auf 'de-DE' formatieren, sondern `useLocale()` benutzen.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Lang, Vars } from './types'
import { useAuth } from '../lib/auth'
import { common } from './dict/common'

export type { Lang, Vars } from './types'
export { defineDict } from './types'

// ---------------------------------------------------------------------------
// Woerterbuecher zusammenfuehren — je Bereich eine Zeile pro Sprache.
// ---------------------------------------------------------------------------
const DE = {
  ...common.de,
  // ...weitere Bereiche hier einhaengen (z.B. ...editor.de,)
}

/** Alle gueltigen Schluessel. Ein Tippfehler faellt sofort beim Typecheck auf. */
export type TKey = keyof typeof DE

const EN: Partial<Record<TKey, string>> = {
  ...common.en,
  // ...weitere Bereiche hier einhaengen (z.B. ...editor.en,)
}

// ---------------------------------------------------------------------------
// Uebersetzen
// ---------------------------------------------------------------------------
/** Verfuegbare Sprachen (Reihenfolge = Reihenfolge in der Auswahl). */
export const LANGUAGES: readonly Lang[] = ['de', 'en']

/**
 * Sprachnamen bewusst in der jeweiligen Sprache selbst — „Deutsch" heisst in jeder
 * Oberflaeche „Deutsch". So findet sich auch jemand zurecht, der die aktuell
 * eingestellte Sprache nicht lesen kann.
 */
export const LANGUAGE_NAMES: Record<Lang, string> = { de: 'Deutsch', en: 'English' }

/** Zahlen-/Datumsformat je Sprache. Englisch bewusst en-GB: 24-Stunden-Uhr wie im Deutschen. */
export const LOCALES: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' }

const PLACEHOLDER = /\{(\w+)\}/g

function fill(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const v = vars[name]
    // Fehlender Wert: Platzhalter stehen lassen — sichtbare Luecke schlaegt stiller Unsinn.
    return v === undefined || v === null ? whole : String(v)
  })
}

/** Uebersetzen ohne React (z.B. in Hilfsfunktionen, die die Sprache durchgereicht bekommen). */
export function translate(lang: Lang, key: TKey, vars?: Vars): string {
  const de = DE[key] as string | undefined
  const en = EN[key]
  // Leerer englischer Text zaehlt als „fehlt" — sonst verschwindet die Beschriftung.
  const text = (lang === 'en' ? (en && en.length ? en : de) : de) ?? String(key)
  return fill(text, vars)
}

/** Die Uebersetzungsfunktion, die `useT()` liefert. */
export type T = (key: TKey, vars?: Vars) => string

// ---------------------------------------------------------------------------
// Kontext / Provider
// ---------------------------------------------------------------------------
export interface LangContextValue {
  lang: Lang
  /** Zahlen-/Datums-Locale zur aktuellen Sprache ('de-DE' | 'en-GB'). */
  locale: string
  /** Uebersetzen. Identisch zu `useT()`. */
  t: T
  /** Darf der angemeldete Benutzer die Sprache umstellen? (nur Rolle admin) */
  canChange: boolean
  /** Organisationsweit speichern — wirft bei fehlender Berechtigung. */
  setLang: (next: Lang) => Promise<void>
  /** Nur in diesem Fenster anwenden, ohne Schreibzugriff (Player: Sprache aus dem Inhalt). */
  applyLang: (next: Lang) => void
}

const STORE_KEY = 'signage_lang'

function isLang(v: unknown): v is Lang {
  return v === 'de' || v === 'en'
}

/**
 * Letzte bekannte Sprache. NUR ein Zwischenspeicher fuer den ersten Bildaufbau
 * (Anmeldeseite, Player ohne Netz) — massgeblich ist immer der Server.
 */
function readCache(): Lang {
  try {
    const v = localStorage.getItem(STORE_KEY)
    if (isLang(v)) return v
  } catch { /* privater Modus o.ae. */ }
  return 'de'
}

function writeCache(l: Lang): void {
  try { localStorage.setItem(STORE_KEY, l) } catch { /* ignorieren */ }
}

const Ctx = createContext<LangContextValue | null>(null)

/**
 * Stellt die Sprache bereit. Gehoert IN den AuthProvider (er liefert die Rolle) und
 * UM den Router (Anmeldeseite und Player sollen ebenfalls uebersetzt sein).
 */
export function LangProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [lang, setLangState] = useState<Lang>(readCache)

  const apply = useCallback((next: Lang) => {
    setLangState((prev) => (prev === next ? prev : next))
    writeCache(next)
  }, [])

  // Massgeblich ist der Server. Nach der Anmeldung (und bei Benutzerwechsel) neu holen.
  useEffect(() => {
    if (!user) return
    let alive = true
    api.get<{ settings: { language: Lang } }>('/settings')
      .then((r) => { if (alive && isLang(r?.settings?.language)) apply(r.settings.language) })
      .catch(() => { /* Anzeige laeuft mit der zuletzt bekannten Sprache weiter */ })
    return () => { alive = false }
  }, [user?.id, apply])

  // Hilft Browser, Vorlesewerkzeugen und der Silbentrennung.
  useEffect(() => { document.documentElement.lang = lang }, [lang])

  const canChange = user?.role === 'admin'

  const setLang = useCallback(async (next: Lang) => {
    const r = await api.patch<{ settings: { language: Lang } }>('/settings', { language: next })
    apply(isLang(r?.settings?.language) ? r.settings.language : next)
  }, [apply])

  const value = useMemo<LangContextValue>(() => ({
    lang,
    locale: LOCALES[lang],
    t: (key, vars) => translate(lang, key, vars),
    canChange,
    setLang,
    applyLang: apply,
  }), [lang, canChange, setLang, apply])

  return React.createElement(Ctx.Provider, { value }, children)
}

function useLangContext(): LangContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    // Klare Ansage statt stiller Fehlanzeige: der Baustein haengt ausserhalb des Providers.
    throw new Error('i18n: useT()/useLang() ohne <LangProvider> benutzt (siehe admin/src/App.tsx).')
  }
  return ctx
}

/** Die Uebersetzungsfunktion der aktuellen Sprache. */
export function useT(): T {
  return useLangContext().t
}

/** Sprache lesen und umstellen (Einstellungen-Seite, Player). */
export function useLang(): LangContextValue {
  return useLangContext()
}

/** Locale fuer `toLocaleString`/`toLocaleDateString` — nie 'de-DE' fest verdrahten. */
export function useLocale(): string {
  return useLangContext().locale
}
