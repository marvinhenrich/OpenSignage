/**
 * Warteschlange fuer Betriebssystem-Befehle (Neustart, Herunterfahren, Screenshot).
 *
 * WARUM: Der Player ist eine Webseite. Sie kann sich neu laden, aber den Rechner nicht
 * neu starten. Im Edge-Kiosk gibt es keine OS-Bruecke - die Befehle verpufften bisher.
 * Deshalb holt ein kleiner Geraeteagent (geplante Aufgabe unter SYSTEM) die Befehle hier ab.
 *
 * Bewusst NUR im Arbeitsspeicher: ein Befehl ist eine Momentaufnahme. Nach einem
 * CMS-Neustart soll KEIN alter Neustart-Befehl nachtraeglich eine Flotte durchstarten.
 *
 * Sicherheitsgedanken (der Agent laeuft als SYSTEM und kann Rechner neu starten):
 *  - Jeder Befehl wird GENAU EINMAL ausgeliefert (danach ist er aus der Liste).
 *  - Befehle verfallen nach 5 Minuten - ein Geraet, das lange offline war, startet
 *    nicht beim naechsten Einschalten unvermittelt neu.
 *  - Die Warteschlange je Display ist hart begrenzt.
 */

export type OsCommandCode = 'REBOOT' | 'SHUTDOWN' | 'SCREENSHOT'

export interface OsCommand {
  id: string
  code: OsCommandCode
  at: number
}

/** Nach dieser Zeit gilt ein Befehl als verfallen und wird nicht mehr ausgeliefert. */
const EXPIRY_MS = 5 * 60_000
/** Mehr als das kann kein sinnvoller Bedienvorgang sein. */
const MAX_PER_DISPLAY = 5

const queues = new Map<string, OsCommand[]>()

function prune(list: OsCommand[]): OsCommand[] {
  const now = Date.now()
  return list.filter((c) => now - c.at < EXPIRY_MS)
}

/** Befehl fuer ein Display einreihen. Gibt die Vorgangsnummer zurueck (fuer das Protokoll). */
export function enqueueOsCommand(displayId: string, code: OsCommandCode): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const list = prune(queues.get(displayId) ?? [])
  list.push({ id, code, at: Date.now() })
  // Bei Ueberlauf die aeltesten verwerfen - der neueste Wunsch zaehlt.
  queues.set(displayId, list.slice(-MAX_PER_DISPLAY))
  return id
}

/**
 * Offene Befehle abholen. Sie werden dabei ENTFERNT - jeder Befehl geht genau einmal raus.
 * Bricht der Agent danach ab, geht der Befehl verloren; das ist gewollt: lieber ein
 * verlorener Neustart als ein doppelter.
 */
export function takeOsCommands(displayId: string): OsCommand[] {
  const list = prune(queues.get(displayId) ?? [])
  queues.delete(displayId)
  return list
}

/** Nur schauen, ob etwas ansteht (fuer die Anzeige im CMS). */
export function pendingOsCommands(displayId: string): number {
  return prune(queues.get(displayId) ?? []).length
}

/** Aufraeumen, wenn ein Display geloescht wird. */
export function forgetOsCommands(displayId: string): void {
  queues.delete(displayId)
}
