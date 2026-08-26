import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider } from './lib/toast'
import { LangProvider, useT } from './i18n'
import Shell from './components/Shell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import MediaPage from './pages/Media'
import LayoutsPage from './pages/Layouts'
import LayoutEditor from './pages/LayoutEditor'
import DisplaysPage from './pages/Displays'
import WallPage from './pages/Wall'
import GroupsPage from './pages/Groups'
import CampaignsPage from './pages/Campaigns'
import SchedulePage from './pages/Schedule'
import EmergencyPage from './pages/Emergency'
import UsersPage from './pages/Users'
import StatsPage from './pages/Stats'
import AuditPage from './pages/Audit'
import GuidePage from './pages/Guide'
import SettingsPage from './pages/Settings'
import ModulesPage from './pages/Modules'
import Player from './pages/Player'
import { PageHeader, EmptyState } from './components/ui'

function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <EmptyState title="In Arbeit" hint="Dieser Bereich wird als Nächstes gebaut." />
    </div>
  )
}

function Protected() {
  const { user, loading } = useAuth()
  const t = useT()
  if (loading) {
    return <div className="flex h-full items-center justify-center text-slate-400">{t('common.loading')}</div>
  }
  if (!user) return <Login />
  return <Shell />
}

/** Nur für Admins erreichbar — Nicht-Admins landen beim Dashboard. */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <ToastProvider>
    <AuthProvider>
      {/* Sprache liegt IM AuthProvider (Rolle) und UM den Router (Anmeldeseite + Player). */}
      <LangProvider>
      <BrowserRouter>
        <Routes>
          {/* Player läuft ohne Login im Vollbild (Kiosk) */}
          <Route path="/player" element={<Player />} />
          <Route element={<Protected />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/medien" element={<MediaPage />} />
            <Route path="/layouts" element={<LayoutsPage />} />
            <Route path="/layouts/:id" element={<LayoutEditor />} />
            <Route path="/kampagnen" element={<CampaignsPage />} />
            <Route path="/displays" element={<DisplaysPage />} />
            <Route path="/wall" element={<WallPage />} />
            <Route path="/gruppen" element={<GroupsPage />} />
            <Route path="/zeitplan" element={<SchedulePage />} />
            <Route path="/sofort" element={<EmergencyPage />} />
            <Route path="/statistik" element={<StatsPage />} />
            <Route path="/benutzer" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
            <Route path="/module" element={<RequireAdmin><ModulesPage /></RequireAdmin>} />
            <Route path="/audit" element={<RequireAdmin><AuditPage /></RequireAdmin>} />
            <Route path="/anleitung" element={<GuidePage />} />
            <Route path="/einstellungen" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </LangProvider>
    </AuthProvider>
    </ToastProvider>
  )
}
