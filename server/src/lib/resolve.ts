/**
 * Content-Resolver: bestimmt, was ein Display JETZT anzeigen soll.
 * Regel: passender aktiver Zeitplan (höchste Priorität) → dessen Layout ODER Kampagne;
 * sonst das Standard-Layout des Displays.
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { schedules, displayGroupMembers, campaignLayouts } from '../db/schema.js'
import { getLayoutTree } from './layoutTree.js'

type Recurrence = { freq?: string; byDay?: number[]; startTime?: string; endTime?: string }
type Tree = Awaited<ReturnType<typeof getLayoutTree>>

function localNow(now: Date, tz: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { day: map[wd] ?? 0, minutes: (hh % 24) * 60 + mm }
}

function toMin(t?: string): number | null {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function daypartMatches(rec: Recurrence, now: Date, tz: string): boolean {
  const { day, minutes } = localNow(now, tz)
  if (rec.byDay && rec.byDay.length && !rec.byDay.includes(day)) return false
  const start = toMin(rec.startTime)
  const end = toMin(rec.endTime)
  if (start !== null && end !== null) {
    if (start <= end) return minutes >= start && minutes <= end
    return minutes >= start || minutes <= end
  }
  return true
}

function versionOf(tree: NonNullable<Tree>): string {
  return `${tree.id}:${tree.publishedVersion}:${new Date(tree.updatedAt).getTime()}`
}

export interface ResolvedContent {
  mode: 'layout' | 'campaign' | 'emergency' | 'none'
  layout?: Tree
  campaignLayouts?: NonNullable<Tree>[]
  campaignName?: string
  emergency?: Record<string, unknown>
  version: string
  source: 'schedule' | 'default' | 'override' | 'none'
}

export async function resolveDisplayContent(display: {
  id: string; defaultLayoutId: string | null; timezone: string | null; override?: Record<string, unknown> | null
}): Promise<ResolvedContent> {
  const now = new Date()
  const tz = display.timezone || 'Europe/Berlin'

  // Sofort-Einblendung (Notfall-Overlay) hat immer Vorrang
  const ov = display.override
  if (ov && typeof ov === 'object' && ov.text) {
    const until = ov.until ? new Date(ov.until as string) : null
    if (!until || until > now) {
      return { mode: 'emergency', emergency: ov, version: 'emergency:' + JSON.stringify(ov), source: 'override' }
    }
  }

  const memberships = await db.select({ g: displayGroupMembers.groupId })
    .from(displayGroupMembers).where(eq(displayGroupMembers.displayId, display.id))
  const groupIds = memberships.map((m) => m.g)

  const all = await db.select().from(schedules)
  const active = all.filter((s) => {
    const targeted = s.displayId === display.id || (s.displayGroupId != null && groupIds.includes(s.displayGroupId))
    if (!targeted) return false
    if (s.type === 'layout' && !s.layoutId) return false
    if (s.type === 'campaign' && !s.campaignId) return false
    if (s.type !== 'layout' && s.type !== 'campaign') return false
    if (new Date(s.fromDt) > now) return false
    if (s.toDt && new Date(s.toDt) < now) return false
    if (s.recurrence && !daypartMatches(s.recurrence as Recurrence, now, tz)) return false
    return true
  })
  active.sort((a, b) => (b.priority - a.priority) || (new Date(b.fromDt).getTime() - new Date(a.fromDt).getTime()))
  const chosen = active[0]

  // Kampagne: Layouts in Reihenfolge abspielen
  if (chosen?.type === 'campaign' && chosen.campaignId) {
    const rows = await db.select({ layoutId: campaignLayouts.layoutId })
      .from(campaignLayouts).where(eq(campaignLayouts.campaignId, chosen.campaignId))
      .orderBy(asc(campaignLayouts.orderIndex))
    const trees: NonNullable<Tree>[] = []
    for (const r of rows) { const t = await getLayoutTree(r.layoutId); if (t) trees.push(t) }
    if (trees.length === 0) return { mode: 'none', version: 'none', source: 'schedule' }
    return {
      mode: 'campaign',
      campaignLayouts: trees,
      version: 'campaign:' + chosen.campaignId + ':' + trees.map(versionOf).join('|'),
      source: 'schedule',
    }
  }

  // Layout (aus Zeitplan oder Standard)
  const layoutId = chosen?.layoutId ?? display.defaultLayoutId
  if (!layoutId) return { mode: 'none', version: 'none', source: 'none' }
  const layout = await getLayoutTree(layoutId)
  if (!layout) return { mode: 'none', version: 'none', source: 'none' }
  return { mode: 'layout', layout, version: versionOf(layout), source: chosen ? 'schedule' : 'default' }
}
