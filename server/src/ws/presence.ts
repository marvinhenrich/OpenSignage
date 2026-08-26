/**
 * Live-Präsenz für den Layout-Editor (wie in PowerPoint): verfolgt, welche Nutzer
 * gerade in welchem Layout sind, und broadcastet die Belegung an alle Editoren.
 */
import type { WebSocket } from 'ws'

interface Peer { userId: string; username: string; layoutId: string | null }
const peers = new Map<WebSocket, Peer>()

function send(ws: WebSocket, msg: unknown) {
  try { if (ws.readyState === 1) ws.send(JSON.stringify(msg)) } catch { /* ignorieren */ }
}

/** { layoutId: [{userId, username}] } — pro Nutzer nur einmal (auch bei mehreren Tabs). */
function snapshot(): Record<string, { userId: string; username: string }[]> {
  const map: Record<string, { userId: string; username: string }[]> = {}
  for (const p of peers.values()) {
    if (!p.layoutId) continue
    const arr = (map[p.layoutId] ??= [])
    if (!arr.some((u) => u.userId === p.userId)) arr.push({ userId: p.userId, username: p.username })
  }
  return map
}

function broadcast(): void {
  const msg = { type: 'presence', layouts: snapshot() }
  for (const ws of peers.keys()) send(ws, msg)
}

export function addPeer(ws: WebSocket, userId: string, username: string): void {
  peers.set(ws, { userId, username, layoutId: null })
  send(ws, { type: 'presence', layouts: snapshot() })
}

export function setPeerLayout(ws: WebSocket, layoutId: string | null): void {
  const p = peers.get(ws)
  if (p) { p.layoutId = layoutId; broadcast() }
}

export function removePeer(ws: WebSocket): void {
  if (peers.delete(ws)) broadcast()
}
