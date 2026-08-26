import { useEffect, useState } from 'react'
import { notify, notifyOk } from '../lib/toast'
import { api, type Campaign, type CampaignLayout, type Layout } from '../lib/api'
import { Button, Card, Badge, PageHeader, EmptyState } from '../components/ui'
import { IconPlus, IconTrash, IconLayouts } from '../components/icons'

export default function Campaigns() {
  const [list, setList] = useState<Campaign[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [items, setItems] = useState<CampaignLayout[]>([])
  const [name, setName] = useState('')
  const [addId, setAddId] = useState('')
  const [err, setErr] = useState('')

  const loadList = () => api.get<{ campaigns: Campaign[] }>('/campaigns').then((r) => setList(r.campaigns)).catch((e) => setErr(e.message))
  const loadOne = (id: string) => api.get<{ campaign: { layouts: CampaignLayout[] } }>(`/campaigns/${id}`).then((r) => setItems(r.campaign.layouts)).catch((e) => setErr(e.message))

  useEffect(() => { loadList(); api.get<{ layouts: Layout[] }>('/layouts').then((r) => setLayouts(r.layouts)).catch((e: any) => notify(e.message)) }, [])
  useEffect(() => { if (sel) loadOne(sel) }, [sel])

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    try { const r = await api.post<{ campaign: Campaign }>('/campaigns', { name }); setName(''); await loadList(); setSel(r.campaign.id) }
    catch (e: any) { setErr(e.message) }
  }
  async function del(id: string) {
    if (!confirm('Kampagne löschen?')) return
    try { await api.del(`/campaigns/${id}`); if (sel === id) setSel(null); await loadList() } catch (e: any) { setErr(e.message) }
  }
  async function save(newItems: CampaignLayout[]) {
    if (!sel) return
    setItems(newItems)
    try { await api.put(`/campaigns/${sel}/layouts`, { layoutIds: newItems.map((i) => i.layoutId) }); await loadList() } catch (e: any) { setErr(e.message) }
  }
  function add() {
    const l = layouts.find((x) => x.id === addId); if (!l) return
    save([...items, { layoutId: l.id, orderIndex: items.length, name: l.name, status: l.status }]); setAddId('')
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return
    const arr = [...items]; const [x] = arr.splice(from, 1); arr.splice(to, 0, x); save(arr)
  }
  function remove(i: number) { save(items.filter((_, idx) => idx !== i)) }

  const selC = list.find((c) => c.id === sel)

  return (
    <div>
      <PageHeader title="Kampagnen" subtitle="Mehrere Layouts zu einer Abfolge bündeln (nacheinander abgespielt)" />
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px,1fr]">
        <div className="space-y-4">
          <Card>
            {list.length === 0 ? <div className="p-5 text-sm text-slate-400">Noch keine Kampagnen.</div> : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => setSel(c.id)}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${sel === c.id ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'} cursor-pointer`}>
                      <span className="font-medium">{c.name}</span>
                      <Badge>{c.layoutCount ?? 0} Layouts</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <form onSubmit={create} className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Neue Kampagne…" required
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
              <Button type="submit"><IconPlus className="h-4 w-4" /></Button>
            </form>
          </Card>
        </div>

        <div>
          {!selC ? <EmptyState title="Kampagne wählen" hint="Links eine Kampagne auswählen, um Layouts anzuordnen." /> : (
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">{selC.name}</h2>
                <button onClick={() => del(selC.id)} className="rounded p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"><IconTrash className="h-4 w-4" /></button>
              </div>

              <div className="mb-4 flex gap-2">
                <select value={addId} onChange={(e) => setAddId(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                  <option value="">Layout hinzufügen…</option>
                  {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}{l.status !== 'published' ? ' (Entwurf)' : ''}</option>)}
                </select>
                <Button onClick={add} disabled={!addId}><IconPlus className="h-4 w-4" />Hinzufügen</Button>
              </div>

              {items.length === 0 ? <div className="text-sm text-slate-400">Noch keine Layouts in dieser Kampagne.</div> : (
                <ul className="space-y-2">
                  {items.map((it, i) => (
                    <li key={it.layoutId} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
                      <span className="text-xs text-slate-400 tabular-nums">{i + 1}</span>
                      <IconLayouts className="h-4 w-4 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate">{it.name}</span>
                      {it.status !== 'published' && <Badge tone="amber">Entwurf</Badge>}
                      <div className="flex flex-col">
                        <button onClick={() => move(i, i - 1)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer text-xs">▲</button>
                        <button onClick={() => move(i, i + 1)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer text-xs">▼</button>
                      </div>
                      <button onClick={() => remove(i)} className="rounded p-1 text-slate-400 hover:text-red-600 cursor-pointer"><IconTrash className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
