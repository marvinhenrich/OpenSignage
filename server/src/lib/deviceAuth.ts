/**
 * Geraete-Identitaet der Player.
 *
 * PROBLEM: Der `hardwareKey` ist der Windows-Rechnername. Der ist im AD/DNS vollstaendig
 * aufzaehlbar - er ist also ein ANSPRUCH auf eine Identitaet, kein Nachweis. Ohne weiteren
 * Faktor kann jeder Browser im LAN `/player?id=<fremder-rechnername>` oeffnen, den Inhalt
 * eines fremden Displays lesen und der Wall einen falschen Zustand melden.
 *
 * LOESUNG: Ein Geraete-Geheimnis, das der Kiosk-Installer einmal je Geraet erzeugt und
 * ueber die Player-URL mitgibt. Der Server speichert nur dessen SHA-256.
 *
 * RUECKWAERTSKOMPATIBEL (wichtig - es laufen bereits Geraete):
 *  - Display OHNE gespeichertes Geheimnis + Aufruf ohne Geheimnis -> erlaubt (Altgeraet).
 *  - Display OHNE gespeichertes Geheimnis + Aufruf MIT Geheimnis  -> Geheimnis wird gebunden
 *    (Trust-on-first-use) und ist ab sofort Pflicht.
 *  - Display MIT gespeichertem Geheimnis -> Aufruf ohne/mit falschem Geheimnis wird abgewiesen.
 * Ein bereits ausgerolltes Geraet faellt dadurch NICHT aus; es wird erst geschuetzt, wenn es
 * das neue Kiosk-Paket bekommen hat.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { displays, displayLogs } from '../db/schema.js'

/** Es reicht diese minimale Struktur - so koennen Routen mit Teil-Select sie nutzen. */
export type DisplayRef = { id: string; deviceSecretHash: string | null }

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8'), bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export interface DeviceCheck {
  ok: boolean
  /** Nur gesetzt, wenn abgewiesen - Klartext fuer Protokoll/Antwort. */
  reason?: string
}

/**
 * Darf dieses Geraet als dieses Display handeln?
 * Bindet ein erstmalig geliefertes Geheimnis (Trust-on-first-use) und protokolliert
 * jeden Fehlversuch, damit ein Uebernahmeversuch sichtbar wird statt still zu scheitern.
 */
export async function checkDeviceAccess(d: DisplayRef, provided: string | undefined | null): Promise<DeviceCheck> {
  const key = (provided ?? '').trim()

  if (!d.deviceSecretHash) {
    // Noch kein Geheimnis hinterlegt.
    if (!key) return { ok: true }                       // Altgeraet - laeuft weiter
    if (key.length < 16) return { ok: false, reason: 'Geraete-Geheimnis ist zu kurz.' }
    // Erstmalig gesehen -> binden. Ab jetzt ist es Pflicht.
    await db.update(displays).set({ deviceSecretHash: hashSecret(key) }).where(eq(displays.id, d.id))
    await db.insert(displayLogs).values({
      displayId: d.id, level: 'info', code: 'DEVICE_BOUND',
      message: 'Geraete-Geheimnis hinterlegt - dieses Display ist ab jetzt gegen Uebernahme geschuetzt.',
    }).catch(() => {})
    return { ok: true }
  }

  if (!key) {
    await logDenied(d, 'Zugriff ohne Geraete-Geheimnis')
    return { ok: false, reason: 'Dieses Display verlangt ein Geraete-Geheimnis. Bitte das aktuelle Kiosk-Paket ausrollen.' }
  }
  if (!sameHash(hashSecret(key), d.deviceSecretHash)) {
    await logDenied(d, 'Zugriff mit falschem Geraete-Geheimnis')
    return { ok: false, reason: 'Geraete-Geheimnis stimmt nicht. Wurde das Geraet neu aufgesetzt? Dann im CMS die Kopplung zuruecksetzen.' }
  }
  return { ok: true }
}

/** Fehlversuche gedrosselt protokollieren (sonst flutet ein Angreifer das Protokoll). */
const lastDenied = new Map<string, number>()
const DENY_LOG_EVERY_MS = 60_000

async function logDenied(d: DisplayRef, what: string): Promise<void> {
  const now = Date.now()
  const last = lastDenied.get(d.id) ?? 0
  if (now - last < DENY_LOG_EVERY_MS) return
  lastDenied.set(d.id, now)
  if (lastDenied.size > 500) lastDenied.clear()
  await db.insert(displayLogs).values({
    displayId: d.id, level: 'error', code: 'DEVICE_AUTH_FAILED',
    message: `${what} - moeglicher Uebernahmeversuch. Anzeige und Wall wurden NICHT veraendert.`,
  }).catch(() => {})
}
