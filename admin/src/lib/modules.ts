/**
 * Modulzustand der Installation.
 *
 * Der Server entscheidet, was aktiv ist; die Oberflaeche fragt einmal nach und
 * blendet Abgeschaltetes aus. Das ist Bequemlichkeit, keine Sicherheitsgrenze —
 * die Routen sind serverseitig ohnehin zu.
 *
 * Bei einem Fehler gilt bewusst „alles an": ein Netzproblem darf keine Bereiche
 * verstecken, sonst sucht jemand den Fehler an der voellig falschen Stelle.
 */
import { useEffect, useState } from 'react'
import { api } from './api'

export interface Modul {
  id: string
  name: string
  zweck: string
  gruppe: 'Inhalte' | 'Planung' | 'Betrieb'
  braucht?: string[]
  voraussetzung?: string
  widgets?: string[]
  aktiv: boolean
  gesperrtDurch?: string[]
}

let liste: Modul[] | null = null
let laufend: Promise<Modul[]> | null = null
const horcher = new Set<(m: Modul[]) => void>()

export async function ladeModule(erzwingen = false): Promise<Modul[]> {
  if (erzwingen) { liste = null; laufend = null }
  if (liste) return liste
  if (!laufend) {
    laufend = api.get<{ module: Modul[] }>('/modules')
      .then((r) => { liste = r.module; horcher.forEach((h) => h(liste!)); return liste! })
      .catch(() => { laufend = null; return [] })
  }
  return laufend
}

/** Ohne React lesbar. Vor dem Laden gilt alles als aktiv. */
export function modulAktiv(id: string): boolean {
  if (!liste) return true
  const m = liste.find((x) => x.id === id)
  return m ? m.aktiv : true
}

export function useModule(): { module: Modul[]; aktiv: (id: string) => boolean; neu: () => Promise<void> } {
  const [m, setM] = useState<Modul[]>(liste ?? [])
  useEffect(() => {
    horcher.add(setM)
    void ladeModule()
    return () => { horcher.delete(setM) }
  }, [])
  return {
    module: m,
    aktiv: (id) => (m.length ? (m.find((x) => x.id === id)?.aktiv ?? true) : true),
    neu: async () => { await ladeModule(true) },
  }
}
