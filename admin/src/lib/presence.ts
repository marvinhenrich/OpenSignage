import { useEffect, useState } from 'react'

export interface Presence { userId: string; username: string }

/** Meldet den Editor als "in Layout X" an und liefert alle Nutzer, die gerade drin sind. */
export function usePresence(layoutId?: string): Presence[] {
  const [layouts, setLayouts] = useState<Record<string, Presence[]>>({})

  useEffect(() => {
    if (!layoutId) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    let ws: WebSocket | null = null
    let hb: ReturnType<typeof setInterval> | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout> | null = null

    function connect() {
      ws = new WebSocket(`${proto}://${location.host}/ws/presence`)
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'enter', layoutId }))
        hb = setInterval(() => { try { ws?.send(JSON.stringify({ type: 'ping' })) } catch {} }, 25000)
      }
      ws.onmessage = (ev) => {
        try { const m = JSON.parse(ev.data); if (m.type === 'presence') setLayouts(m.layouts ?? {}) } catch {}
      }
      ws.onclose = () => { if (hb) clearInterval(hb); if (!closed) retry = setTimeout(connect, 4000) }
      ws.onerror = () => { try { ws?.close() } catch {} }
    }
    connect()

    return () => {
      closed = true
      try { ws?.send(JSON.stringify({ type: 'leave' })) } catch {}
      if (hb) clearInterval(hb)
      if (retry) clearTimeout(retry)
      ws?.close()
    }
  }, [layoutId])

  return layoutId ? (layouts[layoutId] ?? []) : []
}
