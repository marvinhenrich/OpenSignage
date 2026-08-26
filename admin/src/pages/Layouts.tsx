import { useEffect, useState } from 'react'
import { notify, notifyOk } from '../lib/toast'
import { Link } from 'react-router-dom'
import { api, type Layout } from '../lib/api'
import { Button, Card, PageHeader, EmptyState, Badge, Skeleton } from '../components/ui'
import { IconPlus, IconTrash, IconLayouts, IconCopy } from '../components/icons'

export default function LayoutsPage() {
  const [items, setItems] = useState<Layout[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const load = () => api.get<{ layouts: Layout[] }>('/layouts').then((r) => setItems(r.layouts)).catch((e: any) => notify(e.message)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try { await api.post('/layouts', { name: name.trim(), width: 1920, height: 1080 }); notifyOk('Layout angelegt') } catch (e: any) { notify(e.message) }
    setName(''); setCreating(false); await load()
  }
  async function remove(id: string) {
    if (!confirm('Layout löschen?')) return
    try { await api.del(`/layouts/${id}`); notifyOk('Layout gelöscht') } catch (e: any) { notify(e.message) }
    await load()
  }
  async function duplicate(id: string) {
    try { await api.post(`/layouts/${id}/duplicate`); notifyOk('Layout dupliziert') } catch (e: any) { notify(e.message) }
    await load()
  }

  const statusBadge = (s: Layout['status']) =>
    s === 'published' ? <Badge tone="green">Veröffentlicht</Badge>
    : s === 'archived' ? <Badge>Archiviert</Badge>
    : <Badge tone="amber">Entwurf</Badge>

  return (
    <div>
      <PageHeader title="Layouts" subtitle="Bildschirm-Vorlagen mit Regionen und Playlists"
        action={<Button onClick={() => setCreating((v) => !v)}><IconPlus className="h-4 w-4" />Neues Layout</Button>} />

      {creating && (
        <Card className="mb-4 p-4">
          <form onSubmit={create} className="flex items-center gap-3">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Layout-Name (z. B. Empfang Foyer)"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
            <Button type="submit">Anlegen</Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Abbrechen</Button>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden"><Skeleton className="aspect-video rounded-none" /><div className="p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-3 w-1/3" /></div></Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Noch keine Layouts" hint="Lege ein Layout an, um Inhalte für deine Displays zu gestalten."
          action={<Button onClick={() => setCreating(true)}><IconPlus className="h-4 w-4" />Neues Layout</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((l) => (
            <Card key={l.id} className="group flex flex-col overflow-hidden">
              <Link to={`/layouts/${l.id}`}
                className="flex aspect-video items-center justify-center bg-slate-100 text-slate-300 transition-colors hover:bg-slate-200 hover:text-brand-500 dark:bg-slate-800 dark:text-slate-600 dark:hover:bg-slate-700">
                <IconLayouts className="h-10 w-10" />
              </Link>
              <div className="flex items-center justify-between p-4">
                <div className="min-w-0">
                  <Link to={`/layouts/${l.id}`} className="truncate font-medium hover:text-brand-600 dark:hover:text-brand-400">{l.name}</Link>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                    {l.width}×{l.height} {statusBadge(l.status)}
                  </div>
                </div>
                <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => duplicate(l.id)} title="Duplizieren"
                    className="rounded-lg p-2 text-slate-400 hover:text-brand-600 cursor-pointer">
                    <IconCopy className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(l.id)} title="Löschen"
                    className="rounded-lg p-2 text-slate-400 hover:text-red-600 cursor-pointer">
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
