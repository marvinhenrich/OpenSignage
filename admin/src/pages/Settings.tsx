import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useBrand } from '../lib/brand'
import { Card, PageHeader } from '../components/ui'

const APP_VERSION = '0.1.0'

export default function Settings() {
  const { user } = useAuth()
  const brand = useBrand()
  const [showDev, setShowDev] = useState(false)

  // Hersteller und Kontakt kommen aus der Umgebung (BRAND_VENDOR*). Ist nichts
  // hinterlegt, bleibt die Signatur ganz weg statt eine leere Zeile zu zeigen.
  const hasContact = Boolean(brand.vendorEmail || brand.vendorUrl)

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <PageHeader title="Einstellungen" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Konto</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Benutzer</dt>
              <dd className="font-medium">{user?.username}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Rolle</dt>
              <dd className="font-medium capitalize">{user?.role}</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Über</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Produkt</dt>
              <dd className="font-medium">{brand.name} — Digital Signage</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Version</dt>
              <dd className="font-medium tabular-nums">{APP_VERSION}</dd>
            </div>
          </dl>
        </Card>
      </div>

      {brand.vendor && (
        <div className="mt-auto pt-10 text-center">
          <button
            onClick={() => hasContact && setShowDev((s) => !s)}
            className={`text-[11px] text-slate-300 dark:text-slate-600 ${hasContact ? 'cursor-pointer hover:text-slate-400 dark:hover:text-slate-500' : 'cursor-default'}`}
            title={hasContact ? 'Kontakt anzeigen' : undefined}
          >
            entwickelt von {brand.vendor}
          </button>
          {showDev && hasContact && (
            <div className="mt-2 space-x-3 text-xs text-slate-400">
              {brand.vendorEmail && (
                <a href={`mailto:${brand.vendorEmail}`} className="hover:text-brand-500">{brand.vendorEmail}</a>
              )}
              {brand.vendorUrl && (
                <a href={brand.vendorUrl} target="_blank" rel="noreferrer" className="hover:text-brand-500">
                  {brand.vendorUrl.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
