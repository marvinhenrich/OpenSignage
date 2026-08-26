import { useEffect, useMemo, useRef, useState } from 'react'
import { notify, notifyOk } from '../lib/toast'
import { useEscape } from '../lib/useEscape'
import { api, type Media } from '../lib/api'
import { Button, Card, PageHeader, EmptyState, Badge, Skeleton } from '../components/ui'
import { IconUpload, IconVideo, IconFile, IconTrash } from '../components/icons'

function fmtSize(b?: number | null) {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
const TYPES = [
  { v: '', l: 'Alle' }, { v: 'image', l: 'Bilder' }, { v: 'video', l: 'Videos' },
  { v: 'pdf', l: 'PDF' }, { v: 'audio', l: 'Audio' },
]

export default function MediaPage() {
  const [items, setItems] = useState<Media[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [preview, setPreview] = useState<Media | null>(null)
  const [drag, setDrag] = useState(false)
  const [loading, setLoading] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => api.get<{ media: Media[] }>('/media').then((r) => setItems(r.media)).catch((e) => setError(e.message)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setError('')
    try {
      const arr = Array.from(files)
      for (const file of arr) {
        const form = new FormData(); form.append('file', file); form.append('name', file.name)
        await api.upload('/media', form)
      }
      await load()
      notifyOk(`${arr.length} Datei${arr.length > 1 ? 'en' : ''} hochgeladen`)
    } catch (err: any) { setError(err?.message ?? 'Upload fehlgeschlagen'); notify(err?.message ?? 'Upload fehlgeschlagen') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  async function remove(id: string) {
    if (!confirm('Medium wirklich löschen?')) return
    try { await api.del(`/media/${id}`); notifyOk('Medium gelöscht') } catch (e: any) { notify(e.message) }
    setPreview(null); await load()
  }

  const filtered = useMemo(() => items.filter((m) =>
    (!type || m.type === type) && (!q || m.name.toLowerCase().includes(q.toLowerCase()))), [items, q, type])

  return (
    <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files) }}>
      <PageHeader title="Medien" subtitle="Bilder, Videos und Dokumente für deine Layouts"
        action={
          <>
            <input ref={fileRef} type="file" multiple hidden accept="image/*,video/*,audio/*,application/pdf" onChange={(e) => onFiles(e.target.files)} />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}><IconUpload className="h-4 w-4" />{busy ? 'Lädt hoch…' : 'Hochladen'}</Button>
          </>
        } />

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen…"
          className="w-56 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
        <div className="flex gap-1">
          {TYPES.map((t) => (
            <button key={t.v} onClick={() => setType(t.v)}
              className={`rounded-md px-2.5 py-1.5 text-sm cursor-pointer ${type === t.v ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{t.l}</button>
          ))}
        </div>
        <span className="ml-auto text-sm text-slate-400">{filtered.length} von {items.length}</span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => <Card key={i} className="overflow-hidden"><Skeleton className="aspect-video rounded-none" /><div className="p-3"><Skeleton className="h-3.5 w-2/3" /></div></Card>)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Noch keine Medien" hint="Lade Bilder/Videos hoch — oder zieh Dateien einfach hierher."
          action={<Button onClick={() => fileRef.current?.click()}><IconUpload className="h-4 w-4" />Hochladen</Button>} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((m) => (
            <Card key={m.id} className="group cursor-pointer overflow-hidden" >
              <div className="relative aspect-video bg-slate-100 dark:bg-slate-800" onClick={() => setPreview(m)}>
                {m.type === 'image'
                  ? <img src={`/media/${m.storageKey}`} alt={m.name} loading="lazy" className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center text-slate-400">{m.type === 'video' ? <IconVideo className="h-8 w-8" /> : <IconFile className="h-8 w-8" />}</div>}
                <button onClick={(e) => { e.stopPropagation(); remove(m.id) }} title="Löschen"
                  className="absolute right-2 top-2 rounded-md bg-white/90 p-1.5 text-slate-600 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 dark:bg-slate-900/90 cursor-pointer"><IconTrash className="h-4 w-4" /></button>
              </div>
              <div className="p-3" onClick={() => setPreview(m)}>
                <div className="truncate text-sm font-medium" title={m.name}>{m.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs uppercase text-slate-400">
                  <span>{m.type} · {fmtSize(m.sizeBytes)}</span>
                  {(m.usageCount ?? 0) > 0 && <Badge tone="green">{m.usageCount}× genutzt</Badge>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {drag && <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-brand-600/20 text-lg font-medium text-brand-700 dark:text-brand-200"><div className="rounded-xl border-2 border-dashed border-brand-500 bg-white/80 px-8 py-6 dark:bg-slate-900/80">Dateien zum Hochladen ablegen</div></div>}
      {preview && <PreviewModal media={preview} onClose={() => setPreview(null)} onChanged={load} onDelete={() => remove(preview.id)} />}
    </div>
  )
}

function PreviewModal({ media, onClose, onChanged, onDelete }: { media: Media; onClose: () => void; onChanged: () => void; onDelete: () => void }) {
  useEscape(onClose)
  const [name, setName] = useState(media.name)
  const [err, setErr] = useState('')
  const url = `/media/${media.storageKey}`

  async function save() {
    setErr('')
    try { await api.patch(`/media/${media.id}`, { name }); notifyOk('Gespeichert'); onChanged() } catch (e: any) { setErr(e.message); notify(e.message) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Vorschau</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">✕</button>
        </div>
        <div className="mb-4 flex items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800" style={{ minHeight: 200 }}>
          {media.type === 'image' && <img src={url} alt={media.name} className="max-h-[60vh] w-auto" />}
          {media.type === 'video' && <video src={url} controls className="max-h-[60vh] w-full" />}
          {media.type === 'audio' && <audio src={url} controls className="w-full p-6" />}
          {media.type === 'pdf' && <iframe src={url} title={media.name} className="h-[60vh] w-full rounded-md" />}
        </div>
        {err && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div>}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm font-medium">Name
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
          </label>
          <Button onClick={save}>Speichern</Button>
          <Button variant="danger" onClick={onDelete}><IconTrash className="h-4 w-4" />Löschen</Button>
        </div>
        <div className="mt-3 flex gap-2 text-xs text-slate-400">
          <Badge>{media.type}</Badge><span>{fmtSize(media.sizeBytes)}</span>
          {media.mimeType && <span>· {media.mimeType}</span>}
        </div>
      </div>
    </div>
  )
}
