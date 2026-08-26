/**
 * Modulverwaltung.
 *
 * Das nackte System ist bewusst klein: Displays, Layouts, Medien, Player,
 * Benutzer. Alles darueber hinaus ist ein Modul, das ein Administrator
 * abschalten kann — dann verschwindet es aus der Oberflaeche, aus den Routen
 * und aus der Auswahl der Widgets.
 *
 * GRUNDSATZ: Standard ist AN. Eine bestehende Installation verhaelt sich nach
 * dem Einbau exakt wie vorher; erst ein bewusstes Abschalten aendert etwas.
 *
 * Der KERN ist kein Modul. Er laesst sich nicht abschalten, weil ohne ihn
 * nichts uebrig bliebe, was man noch bedienen koennte.
 *
 * Gespeichert wird in `app_settings` unter `module.<id>`. Kein eigenes Schema,
 * keine Migration: die Tabelle ist genau dafuer da.
 */
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { appSettings } from '../db/schema.js'

export type ModulGruppe = 'Inhalte' | 'Planung' | 'Betrieb'

export interface ModulDef {
  id: string
  name: string
  /** Ein Satz: was der Betrieb bekommt, wenn das Modul an ist. */
  zweck: string
  gruppe: ModulGruppe
  /** Ohne diese Module ergibt dieses hier keinen Sinn. */
  braucht?: string[]
  /** Externe Voraussetzung, die der Betreiber selbst stellen muss. */
  voraussetzung?: string
  /** Widget-Typen, die mit diesem Modul stehen und fallen. */
  widgets?: string[]
}

export const MODULE: ModulDef[] = [
  // --- Inhalte --------------------------------------------------------------
  { id: 'weather', name: 'Wetter', gruppe: 'Inhalte', widgets: ['weather'],
    zweck: 'Wetterkachel mit Ort, Temperatur und Vorhersage.',
    voraussetzung: 'Abruf eines Wetterdienstes über das Internet' },
  { id: 'feeds', name: 'Nachrichtenticker', gruppe: 'Inhalte', widgets: ['rss'],
    zweck: 'Zeigt Schlagzeilen aus einem RSS- oder Atom-Feed.',
    voraussetzung: 'Erreichbare Feed-Adresse' },
  { id: 'webpages', name: 'Webseiten', gruppe: 'Inhalte', widgets: ['webpage', 'embedded_html'],
    zweck: 'Bindet fremde Webseiten und eigenes HTML in eine Region ein.' },
  { id: 'monitoring', name: 'Monitoring (Icinga 2)', gruppe: 'Inhalte', widgets: ['icinga'],
    zweck: 'Bausteine für ein Monitoring-Wallboard: Ampel, Kennzahlen, Problemliste, Verlauf.',
    voraussetzung: 'Icinga-2-API und ein Benutzer mit Leserechten' },

  // --- Planung --------------------------------------------------------------
  { id: 'campaigns', name: 'Kampagnen', gruppe: 'Planung',
    zweck: 'Mehrere Layouts nacheinander als eine Einheit ausspielen.' },
  { id: 'schedule', name: 'Zeitplan', gruppe: 'Planung',
    zweck: 'Steuert, was wann auf welchem Display läuft — mit Tageszeiten und Vorrang.' },
  { id: 'groups', name: 'Display-Gruppen', gruppe: 'Planung',
    zweck: 'Fasst Displays zusammen, damit ein Zeitplan nicht je Gerät gepflegt werden muss.' },

  // --- Betrieb --------------------------------------------------------------
  { id: 'wall', name: 'Wall', gruppe: 'Betrieb',
    zweck: 'Alle Displays als Live-Miniplayer, mit dem gemeldeten Zustand jedes Geräts.' },
  { id: 'emergency', name: 'Sofort-Einblendung', gruppe: 'Betrieb',
    zweck: 'Blendet eine Meldung sofort auf allen betroffenen Displays ein.' },
  { id: 'stats', name: 'Statistik', gruppe: 'Betrieb',
    zweck: 'Verfügbarkeit, Wiedergabenachweis und Fehlerbilder je Display.' },
  { id: 'audit', name: 'Änderungsprotokoll', gruppe: 'Betrieb',
    zweck: 'Hält fest, wer wann was geändert hat.' },
]

const NACH_ID = new Map(MODULE.map((m) => [m.id, m]))

/** Widget-Typ -> Modul, das ihn traegt. Widgets ohne Eintrag gehoeren zum Kern. */
const WIDGET_MODUL = new Map<string, string>()
for (const m of MODULE) for (const w of m.widgets ?? []) WIDGET_MODUL.set(w, m.id)

const SCHLUESSEL = (id: string) => `module.${id}`
const CACHE_MS = 30_000
let cache: { at: number; value: Map<string, boolean> } | null = null

export function invalidateModuleCache(): void {
  cache = null
}

async function laden(): Promise<Map<string, boolean>> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.value
  const m = new Map<string, boolean>()
  for (const def of MODULE) m.set(def.id, true) // Standard: AN
  try {
    const rows = await db.select().from(appSettings)
    for (const r of rows) {
      if (!r.key.startsWith('module.')) continue
      const id = r.key.slice('module.'.length)
      if (NACH_ID.has(id)) m.set(id, r.value !== '0')
    }
  } catch {
    // Tabelle nicht lesbar: im Zweifel alles zeigen. Ein Datenbankproblem darf
    // keine Bereiche stillschweigend verstecken - das sucht sonst niemand dort.
  }
  cache = { at: now, value: m }
  return m
}

/**
 * Ist ein Modul aktiv? Beruecksichtigt Abhaengigkeiten: Ein Zeitplan ohne
 * Gruppen ist noch sinnvoll, eine Gruppe ohne Displays waere es nicht.
 */
export async function modulAktiv(id: string): Promise<boolean> {
  // Unbekannte Kennung nicht blockieren: ein Tippfehler soll kein Feature
  // stillschweigend abschalten.
  if (!NACH_ID.has(id)) return true
  const m = await laden()
  if (!m.get(id)) return false
  for (const dep of NACH_ID.get(id)!.braucht ?? []) {
    if (!m.get(dep)) return false
  }
  return true
}

/** Darf dieser Widget-Typ verwendet werden? */
export async function widgetErlaubt(typ: string): Promise<boolean> {
  const modul = WIDGET_MODUL.get(typ)
  return modul ? modulAktiv(modul) : true
}

/** Welches Modul traegt diesen Widget-Typ? (fuer klare Fehlermeldungen) */
export function modulFuerWidget(typ: string): ModulDef | undefined {
  const id = WIDGET_MODUL.get(typ)
  return id ? NACH_ID.get(id) : undefined
}

export interface ModulStand extends ModulDef {
  aktiv: boolean
  /** Aus wegen einer Abhaengigkeit, nicht aus eigener Entscheidung. */
  gesperrtDurch?: string[]
}

export async function modulListe(): Promise<ModulStand[]> {
  const m = await laden()
  return MODULE.map((def) => {
    const fehlend = (def.braucht ?? []).filter((d) => !m.get(d))
    return {
      ...def,
      aktiv: !!m.get(def.id) && fehlend.length === 0,
      ...(fehlend.length ? { gesperrtDurch: fehlend } : {}),
    }
  })
}

export async function setzeModul(id: string, aktiv: boolean, userId: string | null): Promise<void> {
  if (!NACH_ID.has(id)) throw new Error(`Unbekanntes Modul: ${id}`)
  const key = SCHLUESSEL(id)
  await db.insert(appSettings)
    .values({ key, value: aktiv ? '1' : '0', updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: aktiv ? '1' : '0', updatedBy: userId, updatedAt: new Date() } })
  invalidateModuleCache()
}

/** Welche Module haengen an diesem hier? Fuer die Rueckfrage beim Abschalten. */
export function abhaengigeVon(id: string): ModulDef[] {
  return MODULE.filter((m) => (m.braucht ?? []).includes(id))
}

/** Nur zum Aufraeumen: Eintrag entfernen, damit wieder der Standard gilt. */
export async function moduleZuruecksetzen(id: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, SCHLUESSEL(id)))
  invalidateModuleCache()
}

/**
 * Middleware: sperrt eine ganze Route, wenn ihr Modul aus ist.
 *
 * Bewusst 403 mit klarem Text und eigenem Code — nicht 404. Ein „nicht
 * gefunden" schickt Suchende auf die Fehlersuche im Netzwerk; „abgeschaltet"
 * sagt, wo der Schalter liegt.
 */
export function requireModule(id: string) {
  return async (c: { json: (o: unknown, s?: number) => Response }, next: () => Promise<void>) => {
    if (await modulAktiv(id)) return next()
    const def = MODULE.find((m) => m.id === id)
    return c.json({
      error: `Der Bereich „${def?.name ?? id}“ ist in dieser Installation abgeschaltet. Ein Administrator kann ihn unter Module wieder einschalten.`,
      code: 'MODULE_DISABLED',
    }, 403)
  }
}
