/**
 * Module zu- und abschalten.
 *
 * Das nackte System ist bewusst klein. Was ein Betrieb nicht braucht, schaltet
 * ein Administrator hier ab — dann verschwindet es aus dem Menü, aus den Routen
 * und aus der Auswahl der Inhalte. Standard ist AN: eine Installation verhält
 * sich ohne Zutun genauso wie vorher.
 */
import { useState } from 'react'
import { api } from '../lib/api'
import { useModule, type Modul } from '../lib/modules'
import { useT } from '../i18n'
import { Card, PageHeader } from '../components/ui'

const GRUPPEN: Modul['gruppe'][] = ['Inhalte', 'Planung', 'Betrieb']

export default function Modules() {
  const t = useT()
  const { module, neu } = useModule()
  const [busy, setBusy] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)

  async function schalten(m: Modul) {
    setBusy(m.id); setFehler(null); setHinweis(null)
    try {
      const r = await api.patch<{ mitbetroffen: string[] }>(`/modules/${m.id}`, { aktiv: !m.aktiv })
      await neu()
      // Was durch das Abschalten mit stillsteht, gehört gesagt — sonst sucht
      // jemand später, warum ein ganz anderer Bereich leer ist.
      if (r.mitbetroffen?.length) {
        setHinweis(`Damit steht auch still: ${r.mitbetroffen.join(', ')}.`)
      }
    } catch (e) {
      setFehler(e instanceof Error ? e.message : t('common.error'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader title={t('nav.modules')} />
      <p className="mb-5 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
        Was diese Installation anbietet. Abgeschaltete Module verschwinden aus dem Menü und sind
        auch über die Schnittstelle gesperrt — nicht nur ausgeblendet. Der Kern (Displays, Layouts,
        Medien, Player, Benutzer) lässt sich nicht abschalten.
      </p>

      {fehler && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {fehler}
        </div>
      )}
      {hinweis && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {hinweis}
        </div>
      )}

      <div className="space-y-6">
        {GRUPPEN.map((gruppe) => {
          const teil = module.filter((m) => m.gruppe === gruppe)
          if (!teil.length) return null
          return (
            <section key={gruppe}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{gruppe}</h2>
              <Card className="divide-y divide-slate-100 dark:divide-slate-800">
                {teil.map((m) => (
                  <div key={m.id} className="flex items-start gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{m.name}</div>
                      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{m.zweck}</p>
                      {m.voraussetzung && (
                        <p className="mt-1 text-xs text-slate-400">Voraussetzung: {m.voraussetzung}</p>
                      )}
                      {m.gesperrtDurch?.length && (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          Aus, weil ein benötigtes Modul aus ist: {m.gesperrtDurch.join(', ')}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => schalten(m)}
                      disabled={busy === m.id || !!m.gesperrtDurch?.length}
                      aria-pressed={m.aktiv}
                      title={m.aktiv ? 'Abschalten' : 'Einschalten'}
                      className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${
                        m.aktiv ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                          m.aktiv ? 'left-[22px]' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </Card>
            </section>
          )
        })}
      </div>
    </div>
  )
}
