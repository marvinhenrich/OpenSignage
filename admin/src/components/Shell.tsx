import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { api, type Display, type Role } from '../lib/api'
import { useT, type T, type TKey } from '../i18n'
import { useBrand } from '../lib/brand'
import { useModule } from '../lib/modules'
import { cn } from './ui'
import {
  IconDashboard, IconMedia, IconLayouts, IconDisplays, IconSchedule,
  IconUsers, IconLogout, IconSun, IconMoon, IconTv, IconSettings, IconCampaign, IconGroup, IconAudit, IconChart, IconBook, IconAlert, IconGrid,
} from './icons'

// Beschriftungen stehen als Schluessel in der Navigation, nicht als fertiger Text:
// die Liste wird einmal beim Laden des Moduls gebaut, die Sprache kann sich danach aendern.
type NavItem = { to: string; labelKey: TKey; icon: (p: { className?: string }) => JSX.Element; end?: boolean; adminOnly?: boolean; modul?: string }
const navGroups: { labelKey: TKey | null; items: NavItem[] }[] = [
  {
    labelKey: null,
    items: [
      { to: '/', labelKey: 'nav.dashboard', icon: IconDashboard, end: true },
      { to: '/medien', labelKey: 'nav.media', icon: IconMedia },
      { to: '/layouts', labelKey: 'nav.layouts', icon: IconLayouts },
      { to: '/kampagnen', labelKey: 'nav.campaigns', icon: IconCampaign, modul: 'campaigns' },
      { to: '/displays', labelKey: 'nav.displays', icon: IconDisplays },
      { to: '/wall', labelKey: 'nav.wall', icon: IconGrid, modul: 'wall' },
      { to: '/gruppen', labelKey: 'nav.groups', icon: IconGroup, modul: 'groups' },
      { to: '/zeitplan', labelKey: 'nav.schedule', icon: IconSchedule, modul: 'schedule' },
      { to: '/sofort', labelKey: 'nav.instant', icon: IconAlert, modul: 'emergency' },
      { to: '/statistik', labelKey: 'nav.stats', icon: IconChart, modul: 'stats' },
    ],
  },
  {
    labelKey: 'nav.groupAdmin',
    items: [
      { to: '/benutzer', labelKey: 'nav.users', icon: IconUsers, adminOnly: true },
      { to: '/module', labelKey: 'nav.modules', icon: IconGrid, adminOnly: true },
      { to: '/audit', labelKey: 'nav.audit', icon: IconAudit, adminOnly: true, modul: 'audit' },
      { to: '/anleitung', labelKey: 'nav.guide', icon: IconBook },
      { to: '/einstellungen', labelKey: 'nav.settings', icon: IconSettings },
    ],
  },
]

/** Rollenname der Datenbank ('grafik', 'admin', …) lesbar machen. */
export function roleLabel(t: T, role?: Role | null): string {
  return role ? t(`role.${role}`) : ''
}

function SidebarContent({ role, onNavigate, onLogout, username, pending }: { role?: Role; onNavigate?: () => void; onLogout: () => void; username?: string; pending: number }) {
  const brand = useBrand()
  const { aktiv: modulAn } = useModule()
  const t = useT()
  return (
    <>
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white"><IconTv className="h-5 w-5" /></div>
        <span className="font-semibold">{brand.name}</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {navGroups.map((group, gi) => {
          // Abgeschaltete Module gar nicht erst anbieten - ein Menuepunkt,
          // der in eine Sperrmeldung laeuft, ist schlechter als keiner.
          const items = group.items.filter((n) => (!n.adminOnly || role === 'admin') && (!n.modul || modulAn(n.modul)))
          if (items.length === 0) return null
          return (
            <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
              {group.labelKey && <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t(group.labelKey)}</div>}
              {items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate}
                  className={({ isActive }) => cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
                    isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  )}>
                  <n.icon className="h-5 w-5" /><span className="flex-1">{t(n.labelKey)}</span>
                  {n.to === '/displays' && pending > 0 && (
                    <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-white" title={t('shell.pendingDisplays', { count: pending })}>{pending}</span>
                  )}
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>
      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center justify-between rounded-lg px-2 py-1.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{username}</div>
            <div className="text-xs text-slate-400">{roleLabel(t, role)}</div>
          </div>
          <button onClick={onLogout} title={t('shell.logout')}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800 cursor-pointer"><IconLogout className="h-5 w-5" /></button>
        </div>
      </div>
    </>
  )
}

export default function Shell() {
  const brand = useBrand()
  const { user, logout } = useAuth()
  const { dark, toggle } = useTheme()
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pending, setPending] = useState(0)

  useEffect(() => {
    const load = () => api.get<{ displays: Display[] }>('/displays')
      .then((r) => setPending(r.displays.filter((d) => !d.authorized).length)).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex h-full">
      {/* Desktop-Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:flex">
        <SidebarContent role={user?.role} username={user?.username} onLogout={logout} pending={pending} />
      </aside>

      {/* Mobile-Drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <SidebarContent role={user?.role} username={user?.username} onLogout={logout} pending={pending} onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      {/* Hauptbereich */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
          <button onClick={() => setMenuOpen(true)} title={t('shell.menu')}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer md:hidden">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          </button>
          <div className="flex items-center gap-2 font-semibold md:hidden"><IconTv className="h-5 w-5 text-brand-600" />{brand.name}</div>
          <div className="hidden md:block" />
          <button onClick={toggle} title={t('shell.toggleTheme')}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            {dark ? <IconSun className="h-5 w-5" /> : <IconMoon className="h-5 w-5" />}
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
