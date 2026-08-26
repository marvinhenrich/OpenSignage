/**
 * Beschriftung der Anlage (Name, Hersteller) aus `GET /api/brand`.
 *
 * Der Abruf laeuft ohne Anmeldung, weil Anmeldeseite und ungekoppelter Player den Namen
 * schon vor einer Sitzung brauchen. Er passiert genau einmal je Seitenaufruf und faellt
 * bei einem Fehler still auf den Standardnamen zurueck: ein nicht erreichbarer Endpunkt
 * darf keine leere Kopfzeile erzeugen.
 */
import { useEffect, useState } from 'react'
import { api } from './api'

export interface Brand {
  name: string
  slug: string
  vendor: string
  vendorUrl: string
  vendorEmail: string
}

const DEFAULT: Brand = {
  name: 'OpenSignage',
  slug: 'OpenSignage',
  vendor: '',
  vendorUrl: '',
  vendorEmail: '',
}

let current: Brand = DEFAULT
let pending: Promise<Brand> | null = null
const listeners = new Set<(b: Brand) => void>()

function load(): Promise<Brand> {
  if (!pending) {
    pending = api.get<{ brand: Partial<Brand> }>('/brand')
      .then((r) => {
        current = { ...DEFAULT, ...(r?.brand ?? {}) }
        document.title = `${current.name} — Signage CMS`
        listeners.forEach((fn) => fn(current))
        return current
      })
      .catch(() => current)
  }
  return pending
}

/** Ohne React lesbar (Hilfsfunktionen, Fehlertexte). Vor dem Laden der Standardname. */
export function brand(): Brand {
  return current
}

export function useBrand(): Brand {
  const [value, setValue] = useState(current)
  useEffect(() => {
    listeners.add(setValue)
    void load()
    return () => { listeners.delete(setValue) }
  }, [])
  return value
}
