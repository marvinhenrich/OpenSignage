import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type LayoutTree, type Region, type Widget, type Media, type WidgetType } from '../lib/api'
import { useAuth } from '../lib/auth'
import { usePresence } from '../lib/presence'
import { useEscape } from '../lib/useEscape'
import { notify, notifyOk } from '../lib/toast'
import { RegionPlayer, mediaKey, ICINGA_VIEWS, ICINGA_METRICS, ICINGA_THEMES } from '../components/render'
import { Button, Card, Badge, Modal, EmptyState, cn } from '../components/ui'
import {
  IconPlus, IconTrash, IconMedia, IconVideo, IconFile, IconSettings, IconEye, IconClock, IconRss,
  IconCloud, IconGlobe, IconText, IconChevronUp, IconChevronDown, IconGrip, IconLayers, IconMaximize,
  IconTarget, IconCopy, IconPulse,
} from '../components/icons'
import {
  clamp, round, snapTargets, snapMove, resizeRect, snapResize, MIN_REGION,
  type Rect, type Handle,
} from '../lib/editorGeom'

// ---------------------------------------------------------------------------
// Layout-Editor — Werkbank mit Zoom/Fit, Snapping, Tastatur, Ebenen-Panel und
// Player-getreuer Vorschau (geteilte RegionPlayer/WidgetView aus render.tsx).
// ---------------------------------------------------------------------------

const WIDGET_LABELS: Record<WidgetType, string> = {
  image: 'Bild', video: 'Video', audio: 'Audio', pdf: 'PDF', text: 'Text',
  clock: 'Uhr', weather: 'Wetter', rss: 'RSS', webpage: 'Webseite', embedded_html: 'HTML',
  icinga: 'Icinga',
}
const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
const numCls = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
const colorCls = 'h-9 w-full cursor-pointer rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950'

const HANDLES: { h: Handle; cls: string; cursor: string }[] = [
  { h: 'nw', cls: '-top-1 -left-1', cursor: 'nwse-resize' },
  { h: 'n', cls: '-top-1 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { h: 'ne', cls: '-top-1 -right-1', cursor: 'nesw-resize' },
  { h: 'e', cls: 'top-1/2 -right-1 -translate-y-1/2', cursor: 'ew-resize' },
  { h: 'se', cls: '-bottom-1 -right-1', cursor: 'nwse-resize' },
  { h: 's', cls: '-bottom-1 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { h: 'sw', cls: '-bottom-1 -left-1', cursor: 'nesw-resize' },
  { h: 'w', cls: 'top-1/2 -left-1 -translate-y-1/2', cursor: 'ew-resize' },
]

function widgetPayload(w: Widget) {
  return {
    type: w.type, name: w.name ?? null, mediaId: w.mediaId ?? null,
    durationSeconds: w.durationSeconds, useMediaDuration: (w as any).useMediaDuration === true,
    options: w.options ?? {},
  }
}
function defaultOptions(type: WidgetType): Record<string, any> {
  switch (type) {
    case 'text': return { text: 'Neuer Text', color: '#ffffff', align: 'center' }
    case 'weather': return { location: 'Berlin', color: '#ffffff', background: '#0b3a5b' }
    case 'rss': return { color: '#ffffff', interval: 8 }
    case 'clock': return { format: 'hm' }
    case 'icinga': return { view: 'overview', maxProblems: 6 }
    case 'webpage': return { url: '' }
    default: return {}
  }
}

interface DragState {
  mode: 'move' | 'resize'; handle?: Handle; rid: string
  sx: number; sy: number; start: Rect; moved: boolean; last: Rect
}

// Von außen (Veröffentlichen/Löschen) ansteuerbarer Auto-Save des offenen Widget-Editors.
type WidgetFlush = { flush: () => Promise<unknown>; cancel: () => void }

export default function LayoutEditor() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const [layout, setLayout] = useState<LayoutTree | null>(null)
  const [selRegion, setSelRegion] = useState<string | null>(null)
  const [selWidget, setSelWidget] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [propsOpen, setPropsOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit')
  const [showGrid, setShowGrid] = useState(false)
  const [playPreview, setPlayPreview] = useState(true)
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  const [dragRid, setDragRid] = useState<string | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [undo, setUndo] = useState<{ msg: string; fn: () => void } | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const layoutRef = useRef<LayoutTree | null>(null)
  const scaleRef = useRef(1)
  const loadRef = useRef<() => Promise<void>>(async () => {})
  const patchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const widgetFlushRef = useRef<WidgetFlush | null>(null)
  const stateRef = useRef<any>({})

  const others = usePresence(id).filter((p) => p.userId !== user?.id)

  const load = useCallback(() => api.get<{ layout: LayoutTree }>(`/layouts/${id}`)
    .then((r) => setLayout(r.layout)).catch((e: any) => notify(e.message)), [id])
  loadRef.current = load
  useEffect(() => { load() }, [load])

  // Werkbank vermessen (Fit-Berechnung ohne Rückkopplung: Stage-Höhe ist CSS-fixiert).
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect
      setBox({ w: cr.width, h: cr.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  layoutRef.current = layout
  const PAD = 64
  const fitScale = layout && box.w > 0
    ? Math.max(0.02, Math.min((box.w - PAD) / layout.width, (box.h - PAD) / layout.height))
    : layout ? 720 / layout.width : 1
  const scale = zoomMode === 'fit' ? fitScale : zoomMode
  scaleRef.current = scale

  // Cmd/Ctrl + Mausrad = stufenlos zoomen.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      setZoomMode((prev) => {
        const cur = prev === 'fit' ? scaleRef.current : prev
        return Math.round(clamp(cur * (e.deltaY < 0 ? 1.1 : 0.9), 0.1, 4) * 100) / 100
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // --- Drag/Resize: dauerhafte Fensterlistener, lesen alles aus Refs (kein Stale-Closure, kein Leak).
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current
      const L = layoutRef.current
      if (!d || !L) return
      const s = scaleRef.current
      const dx = (e.clientX - d.sx) / s, dy = (e.clientY - d.sy) / s
      if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true
      const tol = 6 / s
      const targets = snapTargets(L.regions.filter((r) => r.id !== d.rid), L.width, L.height)
      let rect: Rect
      let gv: number[] = [], gh: number[] = []
      if (d.mode === 'move') {
        rect = {
          x: clamp(d.start.x + dx, 0, L.width - d.start.width),
          y: clamp(d.start.y + dy, 0, L.height - d.start.height),
          width: d.start.width, height: d.start.height,
        }
        if (!e.altKey) {
          const sn = snapMove(rect, targets, tol, L.width, L.height)
          rect = { ...rect, x: sn.x, y: sn.y }; gv = sn.guidesV; gh = sn.guidesH
        }
      } else {
        rect = resizeRect(d.handle!, d.start, dx, dy, L.width, L.height, e.shiftKey)
        if (!e.altKey) {
          const sn = snapResize(d.handle!, rect, targets, tol)
          rect = sn.rect; gv = sn.guidesV; gh = sn.guidesH
        }
      }
      d.last = rect
      setLayout((prev) => prev ? { ...prev, regions: prev.regions.map((r) => r.id === d.rid ? { ...r, ...rect } : r) } : prev)
      setGuides({ v: gv, h: gh })
    }
    function onUp() {
      const d = dragRef.current
      dragRef.current = null
      setDragRid(null)
      setGuides({ v: [], h: [] })
      if (!d || !d.moved) return
      const r = round(d.last)
      // Lokalen Stand auf die persistierten Ganzzahlen bringen → UI == Server (kein Reload nötig).
      setLayout((prev) => prev ? { ...prev, regions: prev.regions.map((x) => x.id === d.rid ? { ...x, ...r } : x) } : prev)
      api.patch(`/layouts/regions/${d.rid}`, r).catch((e: any) => { notify(e.message); loadRef.current() })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [])

  function startDrag(e: React.PointerEvent, r: Region, mode: 'move' | 'resize', handle?: Handle) {
    e.stopPropagation()
    if (dragRef.current) return
    setSelRegion(r.id); setSelWidget(null)
    const start: Rect = { x: r.x, y: r.y, width: r.width, height: r.height }
    dragRef.current = { mode, handle, rid: r.id, sx: e.clientX, sy: e.clientY, start, moved: false, last: start }
    setDragRid(r.id)
  }

  // --- Datenoperationen (optimistisch; load() nur bei strukturellen Änderungen) ---
  function mutateRegion(rid: string, patch: Partial<Region>) {
    setLayout((prev) => prev ? { ...prev, regions: prev.regions.map((r) => r.id === rid ? { ...r, ...patch } : r) } : prev)
  }
  // Eine ausstehende Regions-Geometrie sofort persistieren; idempotent (läuft nur, solange ein Timer offen ist).
  function flushRegionPatch(rid: string): Promise<unknown> {
    const timer = patchTimers.current[rid]
    if (timer === undefined) return Promise.resolve()
    clearTimeout(timer)
    delete patchTimers.current[rid]
    const r = layoutRef.current?.regions.find((x) => x.id === rid)
    if (!r) return Promise.resolve()
    return api.patch(`/layouts/regions/${rid}`, round({ x: r.x, y: r.y, width: r.width, height: r.height }))
      .catch((e: any) => { notify(e.message); loadRef.current() })
  }
  function scheduleGeomPatch(rid: string) {
    clearTimeout(patchTimers.current[rid])
    patchTimers.current[rid] = setTimeout(() => { flushRegionPatch(rid) }, 300)
  }
  // Alle offenen Nudge-Geometrien synchron persistieren (Veröffentlichen / Verlassen).
  function flushGeomPatches(): Promise<unknown> {
    return Promise.all(Object.keys(patchTimers.current).map((rid) => flushRegionPatch(rid)))
  }
  function nudgeRegion(rid: string, dx: number, dy: number) {
    const L = layoutRef.current; if (!L) return
    const r = L.regions.find((x) => x.id === rid); if (!r) return
    const nx = clamp(r.x + dx, 0, L.width - r.width), ny = clamp(r.y + dy, 0, L.height - r.height)
    if (nx === r.x && ny === r.y) return
    mutateRegion(rid, { x: nx, y: ny })
    scheduleGeomPatch(rid)
  }
  function commitRegionGeom(rid: string, field: 'x' | 'y' | 'width' | 'height', value: number) {
    mutateRegion(rid, { [field]: value } as Partial<Region>)
    api.patch(`/layouts/regions/${rid}`, { [field]: value }).catch((e: any) => { notify(e.message); load() })
  }
  function commitRegionName(rid: string, name: string) {
    const trimmed = name.trim(); if (!trimmed) return
    mutateRegion(rid, { name: trimmed })
    api.patch(`/layouts/regions/${rid}`, { name: trimmed }).catch((e: any) => { notify(e.message); load() })
  }

  async function addRegion() {
    const L = layoutRef.current; if (!L) return
    const w = Math.max(MIN_REGION, Math.round(L.width / 3)), h = Math.max(MIN_REGION, Math.round(L.height / 3))
    const off = Math.min(L.regions.length * 24, Math.max(0, L.width - w), Math.max(0, L.height - h))
    const maxZ = L.regions.reduce((m, r) => Math.max(m, r.zIndex), -1)
    try {
      const res = await api.post<{ region: Region }>(`/layouts/${id}/regions`, {
        name: 'Region', x: clamp(off, 0, L.width - w), y: clamp(off, 0, L.height - h), width: w, height: h, zIndex: maxZ + 1,
      })
      await load()
      setSelRegion(res.region.id); setSelWidget(null)
    } catch (e: any) { notify(e.message) }
  }
  async function duplicateRegion(rid: string) {
    const L = layoutRef.current; if (!L) return
    const src = L.regions.find((r) => r.id === rid); if (!src) return
    const maxZ = L.regions.reduce((m, r) => Math.max(m, r.zIndex), -1)
    try {
      const res = await api.post<{ region: Region }>(`/layouts/${id}/regions`, {
        name: `${src.name} Kopie`, x: clamp(src.x + 24, 0, L.width - src.width), y: clamp(src.y + 24, 0, L.height - src.height),
        width: src.width, height: src.height, zIndex: maxZ + 1, loop: (src as any).loop, transition: (src as any).transition,
      })
      for (const w of src.playlist?.widgets ?? []) await api.post(`/layouts/regions/${res.region.id}/widgets`, widgetPayload(w))
      await load(); setSelRegion(res.region.id); setSelWidget(null); notifyOk('Region dupliziert')
    } catch (e: any) { notify(e.message) }
  }
  async function recreateRegion(src: Region) {
    const maxZ = layoutRef.current?.regions.reduce((m, r) => Math.max(m, r.zIndex), -1) ?? -1
    try {
      const res = await api.post<{ region: Region }>(`/layouts/${id}/regions`, {
        name: src.name, x: Math.round(src.x), y: Math.round(src.y), width: Math.round(src.width), height: Math.round(src.height),
        zIndex: maxZ + 1, loop: (src as any).loop, transition: (src as any).transition,
      })
      for (const w of src.playlist?.widgets ?? []) await api.post(`/layouts/regions/${res.region.id}/widgets`, widgetPayload(w))
      await load(); setSelRegion(res.region.id); notifyOk('Wiederhergestellt')
    } catch (e: any) { notify(e.message) }
  }
  async function deleteRegion(rid: string) {
    const L = layoutRef.current; if (!L) return
    const src = L.regions.find((r) => r.id === rid); if (!src) return
    setLayout((prev) => prev ? { ...prev, regions: prev.regions.filter((r) => r.id !== rid) } : prev)
    setSelRegion(null); setSelWidget(null)
    try { await api.del(`/layouts/regions/${rid}`) } catch (e: any) { notify(e.message); load(); return }
    setUndo({ msg: 'Region gelöscht', fn: () => recreateRegion(src) })
  }
  async function fitRegion(rid: string) {
    const L = layoutRef.current; if (!L) return
    mutateRegion(rid, { x: 0, y: 0, width: L.width, height: L.height })
    api.patch(`/layouts/regions/${rid}`, { x: 0, y: 0, width: L.width, height: L.height }).catch((e: any) => { notify(e.message); load() })
  }
  async function centerRegion(rid: string) {
    const L = layoutRef.current; if (!L) return
    const r = L.regions.find((x) => x.id === rid); if (!r) return
    const x = Math.round((L.width - r.width) / 2), y = Math.round((L.height - r.height) / 2)
    mutateRegion(rid, { x, y })
    api.patch(`/layouts/regions/${rid}`, { x, y }).catch((e: any) => { notify(e.message); load() })
  }
  async function swapLayer(rid: string, dir: 1 | -1) {
    const L = layoutRef.current; if (!L) return
    const sorted = [...L.regions].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
    const i = sorted.findIndex((r) => r.id === rid); const j = i + dir
    if (i < 0 || j < 0 || j >= sorted.length) return
    ;[sorted[i], sorted[j]] = [sorted[j], sorted[i]]
    const zById = new Map(sorted.map((r, idx) => [r.id, idx]))
    const changed = L.regions.filter((r) => r.zIndex !== zById.get(r.id))
    setLayout((prev) => prev ? { ...prev, regions: prev.regions.map((r) => ({ ...r, zIndex: zById.get(r.id) ?? r.zIndex })) } : prev)
    try { for (const r of changed) await api.patch(`/layouts/regions/${r.id}`, { zIndex: zById.get(r.id) }) }
    catch (e: any) { notify(e.message); load() }
  }

  async function addMediaWidget(m: Media) {
    const map: Partial<Record<Media['type'], WidgetType>> = { image: 'image', video: 'video', pdf: 'pdf', audio: 'audio' }
    const type = map[m.type]
    setPicker(false)
    if (!type) { notify('Dieser Medientyp kann nicht als Inhalt verwendet werden'); return }
    const rid = selRegion; if (!rid) return
    try {
      await api.post(`/layouts/regions/${rid}/widgets`, {
        type, name: m.name, mediaId: m.id, durationSeconds: 10, useMediaDuration: type === 'video' || type === 'audio',
      })
      await load()
    } catch (e: any) { notify(e.message) }
  }
  async function addSimpleWidget(type: WidgetType) {
    const rid = selRegion; if (!rid) return
    try {
      const r = await api.post<{ widget: Widget }>(`/layouts/regions/${rid}/widgets`, { type, durationSeconds: 10, options: defaultOptions(type) })
      await load(); setSelWidget(r.widget.id)
    } catch (e: any) { notify(e.message) }
  }
  function saveWidget(rid: string, wid: string, patch: Record<string, unknown>) {
    setLayout((prev) => prev ? {
      ...prev,
      regions: prev.regions.map((r) => r.id !== rid || !r.playlist ? r : {
        ...r, playlist: { ...r.playlist, widgets: r.playlist.widgets.map((w) => w.id === wid ? { ...w, ...patch } as Widget : w) },
      }),
    } : prev)
    return api.patch(`/layouts/widgets/${wid}`, patch).catch((e: any) => { notify(e.message); load() })
  }
  async function recreateWidget(rid: string, src: Widget, index: number) {
    try {
      const res = await api.post<{ widget: Widget }>(`/layouts/regions/${rid}/widgets`, widgetPayload(src))
      const fresh = await api.get<{ layout: LayoutTree }>(`/layouts/${id}`)
      const r = fresh.layout.regions.find((x) => x.id === rid)
      if (r?.playlist) {
        const ids = r.playlist.widgets.map((w) => w.id).filter((x) => x !== res.widget.id)
        ids.splice(Math.min(index, ids.length), 0, res.widget.id)
        await api.post(`/layouts/regions/${rid}/widgets/reorder`, { order: ids })
      }
      await load(); notifyOk('Wiederhergestellt')
    } catch (e: any) { notify(e.message) }
  }
  async function deleteWidget(wid: string) {
    const L = layoutRef.current; if (!L) return
    let src: Widget | undefined, rid = '', index = 0
    for (const r of L.regions) {
      const ws = r.playlist?.widgets ?? []
      const i = ws.findIndex((w) => w.id === wid)
      if (i >= 0) { src = ws[i]; rid = r.id; index = i; break }
    }
    if (!src) return
    setLayout((prev) => prev ? {
      ...prev, regions: prev.regions.map((r) => r.id !== rid || !r.playlist ? r
        : { ...r, playlist: { ...r.playlist, widgets: r.playlist.widgets.filter((w) => w.id !== wid) } }),
    } : prev)
    // Offenen Auto-Save dieses Widgets abbrechen, sonst patcht der Unmount-Flush ein bereits gelöschtes Widget (404).
    if (selWidget === wid) { widgetFlushRef.current?.cancel(); setSelWidget(null) }
    try { await api.del(`/layouts/widgets/${wid}`) } catch (e: any) { notify(e.message); load(); return }
    setUndo({ msg: 'Widget gelöscht', fn: () => recreateWidget(rid, src!, index) })
  }
  function moveWidget(rid: string, from: number, to: number) {
    const L = layoutRef.current; const r = L?.regions.find((x) => x.id === rid)
    if (!r?.playlist) return
    const ws = [...r.playlist.widgets]
    if (to < 0 || to >= ws.length) return
    ;[ws[from], ws[to]] = [ws[to], ws[from]]
    setLayout((prev) => prev ? {
      ...prev, regions: prev.regions.map((x) => x.id !== rid || !x.playlist ? x : { ...x, playlist: { ...x.playlist, widgets: ws } }),
    } : prev)
    api.post(`/layouts/regions/${rid}/widgets/reorder`, { order: ws.map((w) => w.id) }).catch((e: any) => { notify(e.message); load() })
  }
  async function doPublish() {
    setPublishOpen(false)
    try {
      // Erst alle ausstehenden Auto-Saves persistieren (Widget-Optionen + genudgte Geometrie), damit die Player den aktuellen Stand laden.
      await Promise.all([flushGeomPatches(), widgetFlushRef.current?.flush() ?? Promise.resolve()])
      await api.patch(`/layouts/${id}`, { status: 'published' })
      notifyOk('Layout veröffentlicht — Player werden aktualisiert')
    } catch (e: any) { notify(e.message) }
    await load()
  }

  // --- Undo automatisch ausblenden ---
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 6000)
    return () => clearTimeout(t)
  }, [undo])

  // --- Ausstehende Nudge-Patches beim Verlassen noch persistieren (nicht verwerfen) ---
  useEffect(() => () => { flushGeomPatches() }, [])

  // --- Tastatur (input-sicher; Modals behalten ihr eigenes Escape) ---
  stateRef.current = {
    selRegion, selWidget, propsOpen, picker, preview, publishOpen,
    nudgeRegion, deleteRegion, deleteWidget, duplicateRegion, setSelRegion, setSelWidget, setZoomMode,
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === '0') { e.preventDefault(); s.setZoomMode('fit'); return }
      if (mod && e.key === '1') { e.preventDefault(); s.setZoomMode(1); return }
      if (s.propsOpen || s.picker || s.preview || s.publishOpen) return
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (s.selRegion) s.duplicateRegion(s.selRegion); return }
      const rid = s.selRegion
      if (e.key === 'Escape') { s.setSelRegion(null); s.setSelWidget(null); return }
      if (!rid) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (s.selWidget) s.deleteWidget(s.selWidget); else s.deleteRegion(rid)
        return
      }
      const step = e.shiftKey ? 10 : 1
      let dx = 0, dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      e.preventDefault()
      s.nudgeRegion(rid, dx, dy)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!layout) return <div className="text-slate-400">Lädt…</div>

  const sortedRegions = [...layout.regions].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
  const layersTop = [...sortedRegions].reverse()
  const region = layout.regions.find((r) => r.id === selRegion) ?? null
  const cw = layout.width * scale, ch = layout.height * scale
  const dragMode = dragRef.current?.mode

  return (
    <div>
      {/* Kopf */}
      <div className="mb-5">
        <Link to="/layouts" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">← Layouts</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{layout.name}</h1>
              <Badge tone={layout.status === 'published' ? 'green' : 'amber'}>{layout.status === 'published' ? 'Veröffentlicht' : 'Entwurf'}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 tabular-nums">{layout.width}×{layout.height}px · {layout.regions.length} {layout.regions.length === 1 ? 'Region' : 'Regionen'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {others.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" /></span>
                {others.map((o) => o.username).join(', ')} {others.length === 1 ? 'bearbeitet' : 'bearbeiten'} gerade
              </div>
            )}
            <Button variant="ghost" onClick={() => setPreview(true)}><IconEye className="h-4 w-4" />Vorschau</Button>
            <Button variant="ghost" onClick={() => setPropsOpen(true)}><IconSettings className="h-4 w-4" />Eigenschaften</Button>
            <span className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" />
            <Button onClick={() => { (document.activeElement as HTMLElement | null)?.blur?.(); setPublishOpen(true) }}>Veröffentlichen</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr,minmax(340px,420px)]">
        {/* Werkbank */}
        <div>
          <div ref={stageRef} className="stv-stage relative overflow-auto rounded-lg bg-slate-100 dark:bg-slate-900"
            style={{ height: 'clamp(360px, calc(100vh - 16rem), 1400px)' }}>
            <div className="grid min-h-full min-w-full place-items-center p-8">
              <div className="relative select-none overflow-hidden rounded-md shadow-lg ring-1 ring-slate-300 dark:ring-slate-700"
                style={{ width: cw, height: ch, background: layout.backgroundColor }}
                onPointerDown={(e) => { if (e.target === e.currentTarget) { setSelRegion(null); setSelWidget(null) } }}>
                {showGrid && <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(to right, rgba(148,163,184,.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,.18) 1px, transparent 1px)', backgroundSize: `${10 * scale}px ${10 * scale}px` }} />}
                {sortedRegions.map((r) => (
                  <RegionBox key={r.id} r={r} scale={scale} active={r.id === selRegion} play={playPreview}
                    measure={dragRid === r.id ? (dragMode === 'resize' ? `${Math.round(r.width)} × ${Math.round(r.height)}` : `${Math.round(r.x)}, ${Math.round(r.y)}`) : null}
                    onStartMove={(e) => startDrag(e, r, 'move')}
                    onStartResize={(e, h) => startDrag(e, r, 'resize', h)}
                    onSelect={() => { setSelRegion(r.id); setSelWidget(null) }} />
                ))}
                {/* Snap-Hilfslinien */}
                {guides.v.map((x, i) => <div key={`v${i}`} className="pointer-events-none absolute top-0" style={{ left: x * scale, width: 1, height: ch, background: '#60a5fa', zIndex: 20 }} />)}
                {guides.h.map((y, i) => <div key={`h${i}`} className="pointer-events-none absolute left-0" style={{ top: y * scale, height: 1, width: cw, background: '#60a5fa', zIndex: 20 }} />)}
              </div>
            </div>
          </div>

          {/* Canvas-Werkzeugleiste */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
              <button aria-label="Verkleinern" onClick={() => setZoomMode(Math.round(clamp(scale - 0.25, 0.1, 4) * 100) / 100)} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer">−</button>
              <span className="min-w-[3.5rem] text-center text-sm tabular-nums text-slate-600 dark:text-slate-300">{Math.round(scale * 100)}%</span>
              <button aria-label="Vergrößern" onClick={() => setZoomMode(Math.round(clamp(scale + 0.25, 0.1, 4) * 100) / 100)} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer">+</button>
            </div>
            <button onClick={() => setZoomMode('fit')} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm cursor-pointer', zoomMode === 'fit' ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/20 dark:text-brand-300' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800')}><IconMaximize className="h-4 w-4" />Einpassen</button>
            <label className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm', showGrid ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/20 dark:text-brand-300' : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300')}>
              <input type="checkbox" className="accent-brand-600" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />Raster
            </label>
            <label className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm', playPreview ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/20 dark:text-brand-300' : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300')}>
              <input type="checkbox" className="accent-brand-600" checked={playPreview} onChange={(e) => setPlayPreview(e.target.checked)} />Vorschau abspielen
            </label>
            <span className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" />
            <Button variant="ghost" onClick={addRegion}><IconPlus className="h-4 w-4" />Region</Button>
          </div>
          <p className="mt-2 text-xs text-slate-400">Ziehen zum Verschieben · Griffe zum Skalieren · Pfeiltasten fein (Shift = grob) · Alt unterdrückt Einrasten · Entf löscht</p>
        </div>

        {/* Rechtes Panel */}
        <div className="space-y-4">
          <LayerPanel regions={layersTop} selId={selRegion} onSelect={(rid) => { setSelRegion(rid); setSelWidget(null) }}
            onForward={(rid) => swapLayer(rid, 1)} onBack={(rid) => swapLayer(rid, -1)} onDelete={deleteRegion} onAdd={addRegion} />

          {region && (
            <RegionProps key={region.id} region={region} layout={layout}
              onName={(n) => commitRegionName(region.id, n)} onGeom={(f, v) => commitRegionGeom(region.id, f, v)}
              onFit={() => fitRegion(region.id)} onCenter={() => centerRegion(region.id)}
              onDuplicate={() => duplicateRegion(region.id)} onDelete={() => deleteRegion(region.id)} />
          )}

          {region ? (
            <PlaylistPanel region={region} selWidget={selWidget} onSelectWidget={setSelWidget}
              canIcinga={user?.role === 'admin'}
              onAddMedia={() => setPicker(true)} onAddSimple={addSimpleWidget}
              onMove={(from, to) => moveWidget(region.id, from, to)} onDelete={deleteWidget}
              onSave={(wid, patch) => saveWidget(region.id, wid, patch)} widgetFlushRef={widgetFlushRef} />
          ) : (
            <Card className="p-4">
              <EmptyState title="Keine Region ausgewählt" hint="Wähle eine Region im Canvas oder in der Ebenen-Liste, um ihre Playlist zu bearbeiten."
                action={<Button onClick={addRegion}><IconPlus className="h-4 w-4" />Erste Region anlegen</Button>} />
            </Card>
          )}
        </div>
      </div>

      {picker && <MediaPicker onPick={addMediaWidget} onClose={() => setPicker(false)} />}
      {propsOpen && <LayoutProps layout={layout} onClose={() => setPropsOpen(false)} onSaved={async () => { setPropsOpen(false); await load() }} />}
      {preview && <LayoutPreview layout={layout} onClose={() => setPreview(false)} />}
      {publishOpen && (
        <Modal onClose={() => setPublishOpen(false)} className="max-w-md p-6">
          <h2 className="text-lg font-semibold">Layout veröffentlichen</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Der aktuelle Stand wird sofort live an alle verbundenen Displays gesendet, die dieses Layout zeigen.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>Abbrechen</Button>
            <Button onClick={doPublish}>Jetzt live senden</Button>
          </div>
        </Modal>
      )}

      {undo && (
        <div className="fixed bottom-4 left-4 z-[100] flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <span>{undo.msg}</span>
          <button onClick={() => { undo.fn(); setUndo(null) }} className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400 cursor-pointer">Rückgängig</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Canvas-Region: Player-getreue Vorschau + Auswahl/Griffe/Chips als Overlay
// ---------------------------------------------------------------------------
function RegionBox({ r, scale, active, play, measure, onStartMove, onStartResize, onSelect }: {
  r: Region; scale: number; active: boolean; play: boolean; measure: string | null
  onStartMove: (e: React.PointerEvent) => void
  onStartResize: (e: React.PointerEvent, h: Handle) => void
  onSelect: () => void
}) {
  const sig = (r.playlist?.widgets ?? []).map((w) => `${w.id}:${(w as any).enabled}:${w.type}:${mediaKey(w)}:${JSON.stringify(w.options ?? {})}`).join('|')
  const count = r.playlist?.widgets.length ?? 0
  return (
    <div className="absolute" style={{ left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale, zIndex: r.zIndex }}>
      {/* Inhalt (pixelgleich zum Player: unskaliert + containerType, per transform verkleinert) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <RegionPreview region={r} width={r.width} height={r.height} scale={scale} sig={sig} play={play} />
      </div>
      {/* Interaktion + Kontur */}
      <div tabIndex={0} role="button" aria-label={`Region ${r.name}`}
        onPointerDown={onStartMove} onFocus={onSelect}
        className={cn('absolute inset-0 cursor-move touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand-400', active ? 'stv-region--active' : 'stv-region')} />
      {/* Namens-Chip */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 flex items-center gap-1 rounded-br-md rounded-tl bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
        <span className="max-w-[10rem] truncate">{r.name}</span>
        <span className="opacity-70">· {count} {count === 1 ? 'Element' : 'Elemente'}</span>
      </div>
      {/* Live-Maßanzeige beim Ziehen */}
      {measure && <div className="pointer-events-none absolute left-0 top-6 z-10 rounded bg-brand-600 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">{measure}</div>}
      {/* Skalier-Griffe */}
      {active && HANDLES.map(({ h, cls, cursor }) => (
        <div key={h} onPointerDown={(e) => onStartResize(e, h)} style={{ cursor }}
          className={cn('absolute z-10 h-3 w-3 rounded-sm border-2 border-brand-500 bg-white shadow', cls)} />
      ))}
    </div>
  )
}

const RegionPreview = memo(function RegionPreview({ region, width, height, scale, play }: {
  region: Region; width: number; height: number; scale: number; sig: string; play: boolean
}) {
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width, height, transform: `scale(${scale})`, transformOrigin: 'top left', containerType: 'size' }}>
      {play ? <RegionPlayer region={region} /> : <FrozenRegion region={region} />}
    </div>
  )
}, (a, b) => a.play === b.play && a.width === b.width && a.height === b.height && a.scale === b.scale && a.sig === b.sig)

function mapJustify(align?: string) {
  return align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
}
/** Ruhezustand der Editor-Vorschau: erstes Widget statisch, keine Timer/Fetches/Autoplay. */
function FrozenRegion({ region }: { region: Region }) {
  const w = (region.playlist?.widgets ?? []).filter((x) => (x as any).enabled !== false)[0]
  if (!w) return null
  const o = (w.options ?? {}) as Record<string, any>
  const wrap = 'absolute inset-0 h-full w-full'
  if (w.type === 'image') return <img src={`/media/${mediaKey(w)}`} alt="" className={wrap} style={{ objectFit: o.fit ?? 'cover' }} />
  if (w.type === 'video') return <video src={`/media/${mediaKey(w)}`} className={wrap} style={{ objectFit: o.fit ?? 'cover' }} muted preload="metadata" />
  if (w.type === 'text') return (
    <div className={wrap} style={{ display: 'flex', alignItems: o.valign ?? 'center', justifyContent: mapJustify(o.align), color: o.color ?? '#ffffff', background: o.background ?? 'transparent', fontSize: o.fontSize ?? 48, padding: 24, textAlign: (o.align ?? 'center') as any, fontWeight: o.bold ? 700 : 400, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{o.text ?? ''}</div>
  )
  return <div className="absolute inset-0 flex items-center justify-center" style={{ color: '#94a3b8' }}><span style={{ fontSize: '6cqmin' }}>{WIDGET_LABELS[w.type]}</span></div>
}

// ---------------------------------------------------------------------------
// Ebenen-/Regionsliste
// ---------------------------------------------------------------------------
function LayerPanel({ regions, selId, onSelect, onForward, onBack, onDelete, onAdd }: {
  regions: Region[]; selId: string | null
  onSelect: (rid: string) => void; onForward: (rid: string) => void; onBack: (rid: string) => void
  onDelete: (rid: string) => void; onAdd: () => void
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><IconLayers className="h-4 w-4 text-slate-400" />Ebenen</h2>
        <button onClick={onAdd} aria-label="Region hinzufügen" className="rounded-md p-1 text-slate-400 hover:text-brand-600 cursor-pointer"><IconPlus className="h-4 w-4" /></button>
      </div>
      {regions.length === 0 ? (
        <p className="py-2 text-sm text-slate-400">Noch keine Region. Lege eine an, um zu starten.</p>
      ) : (
        <ul className="space-y-1">
          {regions.map((r, i) => {
            const count = r.playlist?.widgets.length ?? 0
            const active = r.id === selId
            return (
              <li key={r.id} onClick={() => onSelect(r.id)}
                className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm', active ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-900/20' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50')}>
                <IconGrip className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="shrink-0 text-xs text-slate-400 tabular-nums">{count}</span>
                <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                  <button aria-label="Nach vorne" disabled={i === 0} onClick={() => onForward(r.id)} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200 cursor-pointer disabled:cursor-not-allowed"><IconChevronUp className="h-4 w-4" /></button>
                  <button aria-label="Nach hinten" disabled={i === regions.length - 1} onClick={() => onBack(r.id)} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200 cursor-pointer disabled:cursor-not-allowed"><IconChevronDown className="h-4 w-4" /></button>
                  <button aria-label="Region löschen" onClick={() => onDelete(r.id)} className="rounded p-1 text-slate-400 hover:text-red-600 cursor-pointer"><IconTrash className="h-4 w-4" /></button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Region-Eigenschaften (Name, Geometrie, Aktionen)
// ---------------------------------------------------------------------------
function RegionProps({ region, layout, onName, onGeom, onFit, onCenter, onDuplicate, onDelete }: {
  region: Region; layout: LayoutTree
  onName: (n: string) => void; onGeom: (f: 'x' | 'y' | 'width' | 'height', v: number) => void
  onFit: () => void; onCenter: () => void; onDuplicate: () => void; onDelete: () => void
}) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold">Eigenschaften</h2>
      <div className="mb-3 flex items-center gap-2">
        <input key={`${region.id}-name`} defaultValue={region.name}
          onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== region.name) onName(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:border-slate-700 dark:bg-slate-950" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <NumberField label="X" value={Math.round(region.x)} min={0} max={layout.width - region.width} onCommit={(v) => onGeom('x', v)} />
        <NumberField label="Y" value={Math.round(region.y)} min={0} max={layout.height - region.height} onCommit={(v) => onGeom('y', v)} />
        <NumberField label="Breite" value={Math.round(region.width)} min={MIN_REGION} max={layout.width - region.x} onCommit={(v) => onGeom('width', v)} />
        <NumberField label="Höhe" value={Math.round(region.height)} min={MIN_REGION} max={layout.height - region.y} onCommit={(v) => onGeom('height', v)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" className="text-xs" onClick={onFit}><IconMaximize className="h-4 w-4" />Einpassen</Button>
        <Button variant="ghost" className="text-xs" onClick={onCenter}><IconTarget className="h-4 w-4" />Zentrieren</Button>
        <Button variant="ghost" className="text-xs" onClick={onDuplicate}><IconCopy className="h-4 w-4" />Duplizieren</Button>
        <Button variant="ghost" className="text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={onDelete}><IconTrash className="h-4 w-4" />Löschen</Button>
      </div>
    </Card>
  )
}

function NumberField({ label, value, min, max, onCommit }: {
  label: string; value: number; min?: number; max?: number; onCommit: (v: number) => void
}) {
  const [txt, setTxt] = useState(String(value))
  const [err, setErr] = useState('')
  useEffect(() => { setTxt(String(value)); setErr('') }, [value])
  function commit() {
    const raw = txt.trim()
    const n = Number(raw)
    if (raw === '' || !Number.isFinite(n)) { setErr(`${label}: Zahl nötig`); setTxt(String(value)); return }
    let v = Math.round(n)
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    setErr(''); setTxt(String(v))
    if (v !== value) onCommit(v)
  }
  return (
    <label className="block text-xs text-slate-500 dark:text-slate-400">{label}
      <input inputMode="numeric" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={cn(numCls, 'mt-0.5', err && 'border-red-400 ring-1 ring-red-400/40')} />
      {err && <span className="mt-0.5 block text-red-600 dark:text-red-400">{err}</span>}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Playlist-Panel
// ---------------------------------------------------------------------------
function PlaylistPanel({ region, selWidget, canIcinga, onSelectWidget, onAddMedia, onAddSimple, onMove, onDelete, onSave, widgetFlushRef }: {
  region: Region; selWidget: string | null; canIcinga: boolean
  onSelectWidget: (wid: string | null) => void; onAddMedia: () => void; onAddSimple: (t: WidgetType) => void
  onMove: (from: number, to: number) => void; onDelete: (wid: string) => void
  onSave: (wid: string, patch: Record<string, unknown>) => void
  widgetFlushRef: React.MutableRefObject<WidgetFlush | null>
}) {
  const widgets = region.playlist?.widgets ?? []
  const addChips: { type: WidgetType; label: string; Icon: (p: { className?: string }) => JSX.Element }[] = [
    { type: 'text', label: 'Text', Icon: IconText },
    { type: 'clock', label: 'Uhr', Icon: IconClock },
    { type: 'weather', label: 'Wetter', Icon: IconCloud },
    { type: 'rss', label: 'RSS', Icon: IconRss },
    { type: 'webpage', label: 'Webseite', Icon: IconGlobe },
    // Monitoring ist IT-Sache: nur Administratoren duerfen die Icinga-Kachel setzen
    // (der Server lehnt sie fuer alle anderen Rollen ohnehin mit 403 ab).
    ...(canIcinga ? [{ type: 'icinga' as WidgetType, label: 'Icinga', Icon: IconPulse }] : []),
  ]
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold">Inhalt hinzufügen</h2>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <button onClick={onAddMedia} className="col-span-3 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 cursor-pointer"><IconMedia className="h-4 w-4" />Medium</button>
        {addChips.map(({ type, label, Icon }) => (
          <button key={type} onClick={() => onAddSimple(type)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"><Icon className="h-4 w-4" />{label}</button>
        ))}
      </div>
      <h2 className="mb-2 text-sm font-semibold">Playlist</h2>
      {widgets.length === 0 ? (
        <EmptyState title="Playlist ist leer" hint="Füge oben ein Medium oder ein Daten-Widget hinzu." />
      ) : (
        <ul className="space-y-2">
          {widgets.map((w, i) => (
            <li key={w.id}>
              <div onClick={() => onSelectWidget(selWidget === w.id ? null : w.id)}
                className={cn('flex cursor-pointer items-center gap-3 rounded-lg border p-2.5', selWidget === w.id ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-800')}>
                <span className="text-xs text-slate-400 tabular-nums">{i + 1}</span>
                <Badge>{WIDGET_LABELS[w.type]}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm">{w.name ?? (w.options as any)?.text ?? WIDGET_LABELS[w.type]}</span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">{(w as any).useMediaDuration && (w.type === 'video' || w.type === 'audio') ? 'auto' : `${w.durationSeconds}s`}</span>
                <div className="flex shrink-0 flex-col" onClick={(e) => e.stopPropagation()}>
                  <button aria-label="Nach oben" onClick={() => onMove(i, i - 1)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"><IconChevronUp className="h-3.5 w-3.5" /></button>
                  <button aria-label="Nach unten" onClick={() => onMove(i, i + 1)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"><IconChevronDown className="h-3.5 w-3.5" /></button>
                </div>
                <button aria-label="Widget löschen" onClick={(e) => { e.stopPropagation(); onDelete(w.id) }} className="shrink-0 rounded p-1 text-slate-400 hover:text-red-600 cursor-pointer"><IconTrash className="h-4 w-4" /></button>
              </div>
              {selWidget === w.id && <WidgetEditor key={w.id} widget={w} onSave={(patch) => onSave(w.id, patch)} flushRef={widgetFlushRef} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Widget-Editor mit Auto-Save (kein Datenverlust beim Widget-Wechsel)
// ---------------------------------------------------------------------------
function ColorOrTransparent({ label, value, onChange }: { label: string; value: any; onChange: (v: string) => void }) {
  const transparent = value == null || value === 'transparent'
  return (
    <div className="text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-slate-500 dark:text-slate-400">{label}</span>
        <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400"><input type="checkbox" className="accent-brand-600" checked={transparent} onChange={(e) => onChange(e.target.checked ? 'transparent' : '#000000')} />transparent</label>
      </div>
      <input type="color" disabled={transparent} value={transparent ? '#000000' : value} onChange={(e) => onChange(e.target.value)} className={cn(colorCls, transparent && 'opacity-40')} />
    </div>
  )
}

function WidgetEditor({ widget, onSave, flushRef }: { widget: Widget; onSave: (patch: Record<string, unknown>) => void; flushRef: React.MutableRefObject<WidgetFlush | null> }) {
  const [name, setName] = useState(widget.name ?? '')
  const [duration, setDuration] = useState<number>(widget.durationSeconds)
  const [useMediaDur, setUseMediaDur] = useState<boolean>((widget as any).useMediaDuration === true)
  const [opt, setOpt] = useState<Record<string, any>>((widget.options ?? {}) as Record<string, any>)
  const set = (k: string, v: any) => setOpt((p) => ({ ...p, [k]: v }))

  const latest = useRef<Record<string, unknown>>({})
  latest.current = { name: name.trim() || null, durationSeconds: Math.max(1, Math.round(duration) || 1), useMediaDuration: useMediaDur, options: opt }
  const onSaveRef = useRef(onSave); onSaveRef.current = onSave
  const mounted = useRef(false)
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    dirty.current = true
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { saveTimer.current = undefined; onSaveRef.current(latest.current); dirty.current = false }, 400)
    return () => clearTimeout(saveTimer.current)
  }, [name, duration, useMediaDur, opt])
  // Ausstehenden Auto-Save von außen erzwingen (Veröffentlichen) bzw. abbrechen (Löschen des Widgets).
  useEffect(() => {
    flushRef.current = {
      flush: () => {
        clearTimeout(saveTimer.current); saveTimer.current = undefined
        if (!dirty.current) return Promise.resolve()
        dirty.current = false
        return Promise.resolve(onSaveRef.current(latest.current))
      },
      cancel: () => { clearTimeout(saveTimer.current); saveTimer.current = undefined; dirty.current = false },
    }
    return () => { flushRef.current = null }
  }, [flushRef])
  useEffect(() => () => { if (dirty.current) onSaveRef.current(latest.current) }, [])

  const isMedia = widget.type === 'video' || widget.type === 'audio'
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
      {widget.type === 'text' && (
        <>
          <textarea className={inputCls} rows={3} value={opt.text ?? ''} onChange={(e) => set('text', e.target.value)} placeholder="Text…" />
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Schriftgröße" value={opt.fontSize ?? 48} min={8} onCommit={(v) => set('fontSize', v)} />
            <label className="text-xs text-slate-500 dark:text-slate-400">Textfarbe<input type="color" className={cn(colorCls, 'mt-0.5')} value={opt.color ?? '#ffffff'} onChange={(e) => set('color', e.target.value)} /></label>
            <ColorOrTransparent label="Hintergrund" value={opt.background} onChange={(v) => set('background', v)} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label>Ausrichtung <select className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950" value={opt.align ?? 'center'} onChange={(e) => set('align', e.target.value)}><option value="left">links</option><option value="center">mittig</option><option value="right">rechts</option></select></label>
            <label className="flex items-center gap-1"><input type="checkbox" className="accent-brand-600" checked={!!opt.bold} onChange={(e) => set('bold', e.target.checked)} /> fett</label>
            <label className="flex items-center gap-1"><input type="checkbox" className="accent-brand-600" checked={!!opt.scroll} onChange={(e) => set('scroll', e.target.checked)} /> Lauftext (Ticker)</label>
            {opt.scroll && <span className="flex items-center gap-1">Dauer <span className="w-16"><NumberField label="Ticker-Dauer" value={opt.scrollSeconds ?? 20} min={5} onCommit={(v) => set('scrollSeconds', v)} /></span>s</span>}
          </div>
        </>
      )}
      {(widget.type === 'image' || widget.type === 'video' || widget.type === 'pdf') && (
        <label className="text-xs text-slate-500 dark:text-slate-400">Anpassung<select className={cn(inputCls, 'mt-0.5')} value={opt.fit ?? 'cover'} onChange={(e) => set('fit', e.target.value)}><option value="cover">füllend (cover)</option><option value="contain">einpassend (contain)</option></select></label>
      )}
      {isMedia && (
        <>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-brand-600" checked={!!opt.sound} onChange={(e) => set('sound', e.target.checked)} /> Ton abspielen (benötigt Kiosk)</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-brand-600" checked={useMediaDur} onChange={(e) => setUseMediaDur(e.target.checked)} /> Volle Medienlänge abspielen</label>
        </>
      )}
      {widget.type === 'webpage' && (
        <label className="text-xs text-slate-500 dark:text-slate-400">URL<input className={cn(inputCls, 'mt-0.5')} value={opt.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://…" /></label>
      )}
      {widget.type === 'embedded_html' && (
        <label className="text-xs text-slate-500 dark:text-slate-400">HTML<textarea className={cn(inputCls, 'mt-0.5 font-mono')} rows={4} value={opt.html ?? ''} onChange={(e) => set('html', e.target.value)} placeholder="<div>…</div>" /></label>
      )}
      {widget.type === 'rss' && (
        <>
          <label className="text-xs text-slate-500 dark:text-slate-400">Feed-URL<input className={cn(inputCls, 'mt-0.5')} value={opt.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://…/feed.xml" /></label>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Wechsel (s)" value={opt.interval ?? 8} min={3} onCommit={(v) => set('interval', v)} />
            <label className="text-xs text-slate-500 dark:text-slate-400">Textfarbe<input type="color" className={cn(colorCls, 'mt-0.5')} value={opt.color ?? '#ffffff'} onChange={(e) => set('color', e.target.value)} /></label>
            <ColorOrTransparent label="Hintergrund" value={opt.background} onChange={(v) => set('background', v)} />
          </div>
        </>
      )}
      {widget.type === 'clock' && (
        <label className="text-xs text-slate-500 dark:text-slate-400">Format<select className={cn(inputCls, 'mt-0.5')} value={opt.format ?? 'hm'} onChange={(e) => set('format', e.target.value)}><option value="hm">Stunden:Minuten</option><option value="hms">mit Sekunden</option></select></label>
      )}
      {widget.type === 'icinga' && (() => {
        // Bestandsschutz: ältere Widgets kennen nur „nur Probleme zeigen" — das ist heute der
        // Baustein „Problemliste" (gleiche Auflösung wie im Renderer).
        const view = ICINGA_VIEWS.some((v) => v.value === opt.view) ? opt.view
          : opt.onlyProblems === true ? 'problems' : 'overview'
        return (
          <>
            <label className="text-xs text-slate-500 dark:text-slate-400">Ansicht (Baustein)
              <select className={cn(inputCls, 'mt-0.5')} value={view}
                onChange={(e) => setOpt((p) => ({ ...p, view: e.target.value, onlyProblems: undefined }))}>
                {ICINGA_VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label} — {v.hint}</option>)}
              </select>
            </label>
            {view === 'count' && (
              <label className="text-xs text-slate-500 dark:text-slate-400">Kennzahl
                <select className={cn(inputCls, 'mt-0.5')} value={opt.metric ?? 'services_critical'} onChange={(e) => set('metric', e.target.value)}>
                  {ICINGA_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
            )}
            {(view === 'overview' || view === 'problems') && (
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Max. Problemzeilen" value={opt.maxProblems ?? 6} min={1} max={30} onCommit={(v) => set('maxProblems', v)} />
              </div>
            )}
            {/* Aussehen gilt für ALLE Bausteine gleichermaßen. Ohne eigene Farbe bringt das
                Theme seinen Grundton mit; mit eigener Farbe rechnet die Kachel Schrift- und
                Statusfarben selbst passend dazu aus (heller Grund → dunkle Schrift und umgekehrt). */}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-500 dark:text-slate-400">Aussehen
                <select className={cn(inputCls, 'mt-0.5')} value={ICINGA_THEMES.some((t) => t.value === opt.theme) ? opt.theme : 'hell'}
                  onChange={(e) => set('theme', e.target.value)}>
                  {ICINGA_THEMES.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.hint}</option>)}
                </select>
              </label>
              <div className="text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Hintergrundfarbe</span>
                  <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                    <input type="checkbox" className="accent-brand-600" checked={!opt.background}
                      onChange={(e) => set('background', e.target.checked ? undefined : '#0f172a')} />
                    Theme-Farbe
                  </label>
                </div>
                <input type="color" disabled={!opt.background} value={typeof opt.background === 'string' ? opt.background : '#ffffff'}
                  onChange={(e) => set('background', e.target.value)}
                  className={cn(colorCls, !opt.background && 'opacity-40')} />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Für jeden Baustein eine eigene Region anlegen — so entsteht die Übersicht nach eigenem Zuschnitt.
              Alle Bausteine eines Layouts teilen sich einen Abruf, mehr Bausteine kosten also keine zusätzliche Last.
              Passen weniger Meldungen in die Region, wechselt die Liste selbstständig auf eine kompakte Darstellung
              und weist den Rest als „+ N weitere" aus. Sind keine Meldungen offen, füllt die Gesamtübersicht die
              Fläche mit Gruppen-Gesundheit, Verlauf, zuletzt Erholtem und Bestätigtem — sie bleibt nie leer.
            </p>
          </>
        )
      })()}
      {widget.type === 'weather' && (
        <>
          <label className="text-xs text-slate-500 dark:text-slate-400">Ort<input className={cn(inputCls, 'mt-0.5')} value={opt.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="z. B. Nürnberg" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">Textfarbe<input type="color" className={cn(colorCls, 'mt-0.5')} value={opt.color ?? '#ffffff'} onChange={(e) => set('color', e.target.value)} /></label>
            <ColorOrTransparent label="Hintergrund" value={opt.background} onChange={(v) => set('background', v)} />
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-500 dark:text-slate-400">Bezeichnung<input className={cn(inputCls, 'mt-0.5')} value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" /></label>
        {!(isMedia && useMediaDur) && <NumberField label="Dauer (s)" value={duration} min={1} onCommit={setDuration} />}
      </div>
      <p className="text-[11px] text-slate-400">Änderungen werden automatisch gespeichert.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vollbild-Vorschau (live wie der Player)
// ---------------------------------------------------------------------------
function LayoutPreview({ layout, onClose }: { layout: LayoutTree; onClose: () => void }) {
  useEscape(onClose)
  const [scale, setScale] = useState(0.5)
  useEffect(() => {
    const fit = () => setScale(Math.min((window.innerWidth * 0.92) / layout.width, (window.innerHeight * 0.86) / layout.height))
    fit(); window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [layout.width, layout.height])
  const sorted = [...layout.regions].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mb-3 flex items-center gap-4 text-sm text-white/80">
        <span className="tabular-nums">Vorschau · {layout.name} · {layout.width}×{layout.height}</span>
        <button onClick={onClose} className="rounded-md bg-white/10 px-3 py-1 hover:bg-white/20 cursor-pointer">Schließen ✕</button>
      </div>
      <div onClick={(e) => e.stopPropagation()} className="overflow-hidden shadow-2xl ring-1 ring-white/20"
        style={{ width: layout.width * scale, height: layout.height * scale }}>
        <div style={{ width: layout.width, height: layout.height, transform: `scale(${scale})`, transformOrigin: 'top left', background: layout.backgroundColor, position: 'relative' }}>
          {sorted.map((r) => (
            <div key={r.id} style={{ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height, overflow: 'hidden', containerType: 'size', zIndex: r.zIndex }}>
              <RegionPlayer region={r} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout-Eigenschaften (Presets + Portrait/Landscape)
// ---------------------------------------------------------------------------
const PRESETS: { label: string; w: number; h: number }[] = [
  { label: '1920×1080 (16:9)', w: 1920, h: 1080 },
  { label: '1080×1920 (9:16)', w: 1080, h: 1920 },
  { label: '3840×2160 (4K)', w: 3840, h: 2160 },
  { label: '1280×720 (HD)', w: 1280, h: 720 },
]
function LayoutProps({ layout, onClose, onSaved }: { layout: LayoutTree; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(layout.name)
  const [bg, setBg] = useState(layout.backgroundColor)
  const [w, setW] = useState(String(layout.width))
  const [h, setH] = useState(String(layout.height))
  const [err, setErr] = useState('')

  function parseDim(raw: string, label: string): number | null {
    const n = Number(raw.trim())
    if (raw.trim() === '' || !Number.isFinite(n)) { setErr(`${label}: bitte eine Zahl eingeben`); return null }
    const v = Math.round(n)
    if (v < 320) { setErr(`${label}: mindestens 320px`); return null }
    return v
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    const nw = parseDim(w, 'Breite'); if (nw == null) return
    const nh = parseDim(h, 'Höhe'); if (nh == null) return
    const patch: Record<string, unknown> = {}
    if (name.trim() && name.trim() !== layout.name) patch.name = name.trim()
    if (bg !== layout.backgroundColor) patch.backgroundColor = bg
    if (nw !== layout.width) patch.width = nw
    if (nh !== layout.height) patch.height = nh
    try {
      if (Object.keys(patch).length) await api.patch(`/layouts/${layout.id}`, patch)
      onSaved()
    } catch (e: any) { setErr(e.message) }
  }
  const curW = Number(w), curH = Number(h)
  return (
    <Modal onClose={onClose} className="max-w-md" labelledBy="lp-title">
      <form onSubmit={save} className="space-y-4 p-6">
        <h2 id="lp-title" className="text-lg font-semibold">Layout-Eigenschaften</h2>
        {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div>}
        <label className="block text-sm">Name<input className={cn(inputCls, 'mt-1')} value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="block text-sm">Hintergrundfarbe<input type="color" className={cn(colorCls, 'mt-1 h-10')} value={bg} onChange={(e) => setBg(e.target.value)} /></label>
        <div>
          <div className="mb-1.5 text-sm">Auflösung</div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const active = Number.isFinite(curW) && Number.isFinite(curH) && curW === p.w && curH === p.h
              return <button key={p.label} type="button" onClick={() => { setW(String(p.w)); setH(String(p.h)) }}
                className={cn('rounded-md border px-2 py-1 text-xs cursor-pointer', active ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/20 dark:text-brand-300' : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800')}>{p.label}</button>
            })}
            <button type="button" onClick={() => { setW(h); setH(w) }} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer">↔ Hoch/Quer</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Breite<input inputMode="numeric" className={cn(numCls, 'mt-1')} value={w} onChange={(e) => setW(e.target.value)} /></label>
            <label className="block text-sm">Höhe<input inputMode="numeric" className={cn(numCls, 'mt-1')} value={h} onChange={(e) => setH(e.target.value)} /></label>
          </div>
          <p className="mt-1.5 text-xs text-slate-400">Bei geänderter Auflösung werden vorhandene Regionen proportional mitskaliert.</p>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button><Button type="submit">Speichern</Button></div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Medien-Picker (nur inhaltsfähige Typen)
// ---------------------------------------------------------------------------
function MediaPicker({ onPick, onClose }: { onPick: (m: Media) => void; onClose: () => void }) {
  const [items, setItems] = useState<Media[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { api.get<{ media: Media[] }>('/media').then((r) => setItems(r.media)).catch((e: any) => notify(e.message)).finally(() => setLoading(false)) }, [])
  const usable = items.filter((m) => m.type === 'image' || m.type === 'video' || m.type === 'pdf' || m.type === 'audio')
  return (
    <Modal onClose={onClose} className="max-h-[80vh] max-w-3xl overflow-y-auto" labelledBy="mp-title">
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="mp-title" className="text-lg font-semibold">Medium auswählen</h2>
          <button onClick={onClose} aria-label="Schließen" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">✕</button>
        </div>
        {loading ? <p className="py-8 text-center text-sm text-slate-400">Lädt…</p>
          : usable.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">Keine passenden Medien vorhanden — lade zuerst welche in der Medienbibliothek hoch.</p> : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {usable.map((m) => (
                <button key={m.id} onClick={() => onPick(m)} className="group overflow-hidden rounded-lg border border-slate-200 text-left hover:border-brand-500 dark:border-slate-800 cursor-pointer">
                  <div className="flex aspect-video items-center justify-center bg-slate-100 dark:bg-slate-800">
                    {m.type === 'image' ? <img src={`/media/${m.storageKey}`} alt={m.name} className="h-full w-full object-cover" /> : <span className="text-slate-400">{m.type === 'video' ? <IconVideo className="h-6 w-6" /> : <IconFile className="h-6 w-6" />}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 p-2 text-xs"><span className="truncate">{m.name}</span></div>
                </button>
              ))}
            </div>
          )}
      </div>
    </Modal>
  )
}
