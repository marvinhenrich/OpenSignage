/**
 * RSS/Atom-Feed-Proxy für RSS-Widgets: holt den Feed serverseitig (umgeht CORS)
 * und liefert eine schlanke Liste von Schlagzeilen. Nur http/https, mit Timeout/Größenlimit.
 */
import { Hono } from 'hono'
import { Err } from '../lib/errors.js'

export const feedRoutes = new Hono()

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim()
}
function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? decode(m[1]) : ''
}

feedRoutes.get('/', async (c) => {
  const url = c.req.query('url')
  if (!url || !/^https?:\/\//i.test(url)) throw Err.badRequest('Gültige http(s)-Feed-URL erforderlich')

  let xml: string
  try {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'OpenSignage/1.0' } })
    clearTimeout(to)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    xml = (await res.text()).slice(0, 1_000_000)
  } catch (err) {
    throw Err.unavailable(`Feed nicht erreichbar: ${err instanceof Error ? err.message : 'Fehler'}`)
  }

  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml)
  const blocks = xml.match(isAtom ? /<entry[\s\S]*?<\/entry>/gi : /<item[\s\S]*?<\/item>/gi) ?? []
  const items = blocks.slice(0, 20).map((b) => ({
    title: pick(b, 'title'),
    date: pick(b, isAtom ? 'updated' : 'pubDate'),
  })).filter((i) => i.title)

  return c.json({ items, source: pick(xml, 'title') })
})
