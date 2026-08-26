import { useEffect, useState } from 'react'
import { notify, notifyOk } from '../lib/toast'
import { api, type DisplayGroup, type Display } from '../lib/api'
import { Button, Card, Badge, PageHeader, EmptyState } from '../components/ui'
import { IconPlus, IconTrash, IconDisplays } from '../components/icons'

interface Member { id: string; name: string; status: string; authorized: boolean }

export default function Groups() {
  const [groups, setGroups] = useState<DisplayGroup[]>([])
  const [displays, setDisplays] = useState<Display[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [name, setName] = useState('')
  const [addId, setAddId] = useState('')
  const [err, setErr] = useState('')

  const loadGroups = () => api.get<{ groups: DisplayGroup[] }>('/display-groups').then((r) => setGroups(r.groups)).catch((e) => setErr(e.message))
  const loadMembers = (id: string) => api.get<{ members: Member[] }>(`/display-groups/${id}/members`).then((r) => setMembers(r.members)).catch((e) => setErr(e.message))

  useEffect(() => { loadGroups(); api.get<{ displays: Display[] }>('/displays').then((r) => setDisplays(r.displays)).catch((e: any) => notify(e.message)) }, [])
  useEffect(() => { if (sel) loadMembers(sel) }, [sel])

  async function createGroup(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    try { const r = await api.post<{ group: DisplayGroup }>('/display-groups', { name }); setName(''); await loadGroups(); setSel(r.group.id) }
    catch (e: any) { setErr(e.message) }
  }
  async function delGroup(id: string) {
    if (!confirm('Gruppe löschen?')) return
    try { await api.del(`/display-groups/${id}`); if (sel === id) setSel(null); await loadGroups() } catch (e: any) { setErr(e.message) }
  }
  async function addMember() {
    if (!sel || !addId) return
    try { await api.post(`/display-groups/${sel}/members`, { displayId: addId }); setAddId(''); await loadMembers(sel); await loadGroups() } catch (e: any) { setErr(e.message) }
  }
  async function removeMember(displayId: string) {
    if (!sel) return
    try { await api.del(`/display-groups/${sel}/members/${displayId}`); await loadMembers(sel); await loadGroups() } catch (e: any) { setErr(e.message) }
  }

  const selGroup = groups.find((g) => g.id === sel)
  const nonMembers = displays.filter((d) => !members.some((m) => m.id === d.id))

  return (
    <div>
      <PageHeader title="Anzeigegruppen" subtitle="Displays zu Gruppen bündeln und gemeinsam bespielen" />
      {err && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{err}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px,1fr]">
        <div className="space-y-4">
          <Card>
            {groups.length === 0 ? <div className="p-5 text-sm text-slate-400">Noch keine Gruppen.</div> : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {groups.map((g) => (
                  <li key={g.id}>
                    <button onClick={() => setSel(g.id)}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${sel === g.id ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'} cursor-pointer`}>
                      <span className="font-medium">{g.name}</span>
                      <Badge>{g.memberCount ?? 0} Displays</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <form onSubmit={createGroup} className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Neue Gruppe…" required
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
              <Button type="submit"><IconPlus className="h-4 w-4" /></Button>
            </form>
          </Card>
        </div>

        <div>
          {!selGroup ? <EmptyState title="Gruppe wählen" hint="Links eine Gruppe auswählen, um Displays zuzuordnen." /> : (
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">{selGroup.name}</h2>
                <button onClick={() => delGroup(selGroup.id)} className="rounded p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"><IconTrash className="h-4 w-4" /></button>
              </div>

              <div className="mb-4 flex gap-2">
                <select value={addId} onChange={(e) => setAddId(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                  <option value="">Display hinzufügen…</option>
                  {nonMembers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <Button onClick={addMember} disabled={!addId}><IconPlus className="h-4 w-4" />Hinzufügen</Button>
              </div>

              {members.length === 0 ? <div className="text-sm text-slate-400">Keine Displays in dieser Gruppe.</div> : (
                <ul className="space-y-2">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
                      <span className="flex items-center gap-2"><IconDisplays className="h-4 w-4 text-slate-400" />{m.name}</span>
                      <button onClick={() => removeMember(m.id)} className="rounded p-1 text-slate-400 hover:text-red-600 cursor-pointer"><IconTrash className="h-4 w-4" /></button>
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
