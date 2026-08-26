/**
 * WebSocket-Manager für Player: hält offene Verbindungen, spiegelt den Online-Status
 * in die DB und pusht Live-Nachrichten (reload/command) an einzelne oder alle Displays.
 */
import type { WebSocket } from 'ws'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { displays, displayLogs } from '../db/schema.js'
import { markOnline, markOffline } from './playerState.js'

export interface PlayerClient {
  ws: WebSocket
  hardwareKey: string
  displayId: string
}

const clients = new Set<PlayerClient>()

function send(ws: WebSocket, msg: unknown) {
  try {
    if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(msg))
  } catch { /* ignorieren */ }
}

export async function registerConnection(ws: WebSocket, hardwareKey: string, displayId: string): Promise<PlayerClient> {
  const client: PlayerClient = { ws, hardwareKey, displayId }
  const wasConnected = [...clients].some((c) => c.displayId === displayId)
  clients.add(client)
  // Wall sofort informieren (Live-Push), unabhaengig vom DB-Schreibvorgang
  markOnline(displayId)
  await db.update(displays).set({ status: 'online', lastSeenAt: new Date() }).where(eq(displays.id, displayId))
  if (!wasConnected) {
    await db.insert(displayLogs).values({ displayId, level: 'info', code: 'ONLINE', message: 'Display verbunden' }).catch(() => {})
  }
  return client
}

export async function unregisterConnection(client: PlayerClient): Promise<void> {
  clients.delete(client)
  // Nur offline setzen, wenn keine weitere Verbindung dieses Displays mehr besteht
  const stillConnected = [...clients].some((c) => c.displayId === client.displayId)
  if (!stillConnected) {
    markOffline(client.displayId)
    await db.update(displays).set({ status: 'offline' }).where(eq(displays.id, client.displayId))
    await db.insert(displayLogs).values({ displayId: client.displayId, level: 'info', code: 'OFFLINE', message: 'Display getrennt' }).catch(() => {})
  }
}

export async function touchDisplay(displayId: string): Promise<void> {
  await db.update(displays).set({ lastSeenAt: new Date() }).where(eq(displays.id, displayId))
}

/**
 * Rueckmeldung des Players zu einem Fernsteuerbefehl protokollieren.
 * Ohne das schluckt ein Player nicht ausfuehrbare Befehle (z.B. Neustart/Herunterfahren
 * ohne OS-Bruecke im Edge-Kiosk) stillschweigend - im CMS sah es dann so aus, als
 * haette der Befehl "keine Wirkung". Jetzt steht das Ergebnis im Display-Protokoll.
 */
export async function logCommandResult(displayId: string, code: string, ok: boolean, detail?: string): Promise<void> {
  await db.insert(displayLogs).values({
    displayId,
    level: ok ? 'info' : 'error',
    code: ok ? 'COMMAND_OK' : 'COMMAND_FAILED',
    message: ok
      ? `Befehl ${code} ausgefuehrt`
      : `Befehl ${code} NICHT ausgefuehrt${detail ? ': ' + detail : ''}`,
  }).catch(() => {})
}

/** App-Level-Ping an alle Player: haelt Proxy-Verbindungen offen und laesst den Player Totleitungen erkennen. */
export function pingAll(): void {
  for (const c of clients) send(c.ws, { type: 'ping', ts: Date.now() })
}

export function pushToDisplay(displayId: string, msg: unknown): void {
  for (const c of clients) if (c.displayId === displayId) send(c.ws, msg)
}

export function broadcastReload(reason = 'change'): void {
  for (const c of clients) send(c.ws, { type: 'reload', reason, ts: Date.now() })
}

export function broadcast(msg: unknown): void {
  for (const c of clients) send(c.ws, msg)
}

export function onlineDisplayIds(): Set<string> {
  return new Set([...clients].map((c) => c.displayId))
}
