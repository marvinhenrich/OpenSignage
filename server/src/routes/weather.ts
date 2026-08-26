/**
 * Wetter-Proxy über Open-Meteo (kostenlos, ohne API-Key). Der CMS-Server holt die Daten
 * (hat Internet-Egress) und cacht sie ~10 min, damit die Player kein eigenes Internet brauchen.
 */
import { Hono } from 'hono'
import { Err, AppError } from '../lib/errors.js'

export const weatherRoutes = new Hono()

const cache = new Map<string, { t: number; data: unknown }>()
const TTL = 10 * 60 * 1000

weatherRoutes.get('/', async (c) => {
  const location = (c.req.query('location') || 'Berlin').trim()
  const key = location.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < TTL) return c.json(hit.data as any)

  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=de&format=json`)
    const geo = await geoRes.json() as any
    const g = geo?.results?.[0]
    if (!g) throw Err.badRequest(`Ort nicht gefunden: ${location}`)

    const wxRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto`)
    const wx = await wxRes.json() as any
    const data = {
      city: g.name,
      temp: Math.round(wx.current.temperature_2m),
      code: wx.current.weather_code,
      wind: Math.round(wx.current.wind_speed_10m),
      max: Math.round(wx.daily.temperature_2m_max[0]),
      min: Math.round(wx.daily.temperature_2m_min[0]),
    }
    cache.set(key, { t: Date.now(), data })
    return c.json(data)
  } catch (err) {
    if (err instanceof AppError) throw err
    throw Err.unavailable(`Wetterdienst nicht erreichbar: ${err instanceof Error ? err.message : 'Fehler'}`)
  }
})
