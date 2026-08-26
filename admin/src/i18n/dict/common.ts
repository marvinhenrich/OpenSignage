/**
 * Woerterbuch: Rahmen der Anwendung (Navigation, Anmeldung, Dashboard, Einstellungen,
 * geteilte Kleinbausteine aus `components/ui.tsx`).
 *
 * MUSTER FUER ALLE WEITEREN BEREICHE — bitte genau so anlegen:
 *   1. Neue Datei `admin/src/i18n/dict/<bereich>.ts` (z.B. `editor.ts`, `wall.ts`, `media.ts`).
 *   2. `export const <bereich> = defineDict({ ...deutsch }, { ...englisch })`
 *   3. In `admin/src/i18n/index.ts` importieren und in die Liste `MODULES` eintragen.
 * Schluessel sind FLACH und tragen ihr Bereichspraefix: `editor.publish`, `wall.offlineSince`.
 * Deutsch ist vollstaendig und die Referenz; fehlt ein englischer Text, erscheint der deutsche.
 */
import { defineDict } from '../types'

export const common = defineDict(
  {
    // --- Allgemein -------------------------------------------------------
    'common.error': 'Es ist ein Fehler aufgetreten',
    'common.loading': 'Lädt…',
    'common.save': 'Speichern',
    'common.cancel': 'Abbrechen',

    // --- Rollen (Werte aus der Datenbank lesbar machen) -------------------
    'role.admin': 'Administrator',
    'role.grafik': 'Grafik',
    'role.operator': 'Operator',
    'role.viewer': 'Betrachter',

    // --- Display-Status (components/ui.tsx → StatusDot) -------------------
    'status.online': 'Online',
    'status.offline': 'Offline',
    'status.pending': 'Wartet',

    // --- Navigation -------------------------------------------------------
    'nav.dashboard': 'Dashboard',
    'nav.media': 'Medien',
    'nav.layouts': 'Layouts',
    'nav.campaigns': 'Kampagnen',
    'nav.displays': 'Displays',
    'nav.wall': 'Wall',
    'nav.groups': 'Gruppen',
    'nav.schedule': 'Zeitplan',
    'nav.instant': 'Sofort-Einblendung',
    'nav.stats': 'Statistik',
    'nav.modules': 'Module',
    'nav.users': 'Benutzer',
    'nav.audit': 'Audit-Log',
    'nav.guide': 'Anleitung',
    'nav.settings': 'Einstellungen',
    'nav.groupAdmin': 'Admin',

    // --- Rahmen (Shell) ---------------------------------------------------
    'shell.menu': 'Menü',
    'shell.toggleTheme': 'Design wechseln',
    'shell.logout': 'Abmelden',
    'shell.pendingDisplays': '{count} Display(s) warten auf Freigabe',

    // --- Anmeldung --------------------------------------------------------
    'login.subtitle': 'Digital Signage CMS',
    'login.username': 'Benutzername',
    'login.password': 'Passwort',
    'login.submit': 'Anmelden',
    'login.busy': 'Anmelden…',
    'login.failed': 'Anmeldung fehlgeschlagen',

    // --- Dashboard --------------------------------------------------------
    'dash.title': 'Dashboard',
    'dash.subtitle': 'Überblick über deine Digital-Signage-Flotte',
    'dash.authorizeNow': 'Jetzt freigeben →',
    'dash.displaysOnline': 'Displays online',
    'dash.plays7d': 'Wiedergaben (7 T.)',
    'dash.layouts': 'Layouts',
    'dash.media': 'Medien',
    'dash.displays': 'Displays',
    'dash.noDisplays': 'Noch keine Displays gekoppelt.',
    'dash.unknownResolution': 'unbekannte Auflösung',
    'dash.recentActivity': 'Letzte Aktivität',
    'dash.noEntries': 'Keine Einträge.',
    'dash.system': 'System',

    // --- Einstellungen ----------------------------------------------------
    'settings.title': 'Einstellungen',
    'settings.account': 'Konto',
    'settings.user': 'Benutzer',
    'settings.role': 'Rolle',
    'settings.about': 'Über',
    'settings.product': 'Produkt',
    'settings.version': 'Version',
    'settings.language': 'Sprache',
    'settings.languageLabel': 'Sprache der Oberfläche',
    'settings.languageHint': 'Gilt für alle Benutzer dieser Installation und für die Displays.',
    'settings.languageAdminOnly': 'Nur Administratoren können die Sprache ändern.',
    'settings.languageSaved': 'Sprache gespeichert. Sie gilt jetzt für alle Benutzer und Displays.',
    'settings.languageFailed': 'Sprache konnte nicht gespeichert werden: {error}',
    'settings.devBy': 'entwickelt von {name}',
    'settings.showContact': 'Kontakt anzeigen',
  },
  {
    // --- General ----------------------------------------------------------
    'common.error': 'Something went wrong',
    'common.loading': 'Loading…',
    'common.save': 'Save',
    'common.cancel': 'Cancel',

    // --- Roles ------------------------------------------------------------
    'role.admin': 'Administrator',
    'role.grafik': 'Designer',
    'role.operator': 'Operator',
    'role.viewer': 'Viewer',

    // --- Display status ---------------------------------------------------
    'status.online': 'Online',
    'status.offline': 'Offline',
    'status.pending': 'Pending',

    // --- Navigation -------------------------------------------------------
    'nav.dashboard': 'Dashboard',
    'nav.media': 'Media',
    'nav.layouts': 'Layouts',
    'nav.campaigns': 'Campaigns',
    'nav.displays': 'Displays',
    'nav.wall': 'Wall',
    'nav.groups': 'Groups',
    'nav.schedule': 'Schedule',
    'nav.instant': 'Instant Overlay',
    'nav.stats': 'Reporting',
    'nav.modules': 'Modules',
    'nav.users': 'Users',
    'nav.audit': 'Audit Log',
    'nav.guide': 'Guide',
    'nav.settings': 'Settings',
    'nav.groupAdmin': 'Admin',

    // --- Shell ------------------------------------------------------------
    'shell.menu': 'Menu',
    'shell.toggleTheme': 'Switch theme',
    'shell.logout': 'Sign out',
    'shell.pendingDisplays': '{count} display(s) awaiting authorization',

    // --- Sign-in ----------------------------------------------------------
    'login.subtitle': 'Digital Signage CMS',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.busy': 'Signing in…',
    'login.failed': 'Sign-in failed',

    // --- Dashboard --------------------------------------------------------
    'dash.title': 'Dashboard',
    'dash.subtitle': 'Overview of your digital signage fleet',
    'dash.authorizeNow': 'Authorize now →',
    'dash.displaysOnline': 'Displays online',
    'dash.plays7d': 'Plays (7 d)',
    'dash.layouts': 'Layouts',
    'dash.media': 'Media',
    'dash.displays': 'Displays',
    'dash.noDisplays': 'No displays paired yet.',
    'dash.unknownResolution': 'resolution unknown',
    'dash.recentActivity': 'Recent activity',
    'dash.noEntries': 'No entries.',
    'dash.system': 'System',

    // --- Settings ---------------------------------------------------------
    'settings.title': 'Settings',
    'settings.account': 'Account',
    'settings.user': 'User',
    'settings.role': 'Role',
    'settings.about': 'About',
    'settings.product': 'Product',
    'settings.version': 'Version',
    'settings.language': 'Language',
    'settings.languageLabel': 'Interface language',
    'settings.languageHint': 'Applies to every user of this installation and to the displays.',
    'settings.languageAdminOnly': 'Only administrators can change the language.',
    'settings.languageSaved': 'Language saved. It now applies to all users and displays.',
    'settings.languageFailed': 'Could not save the language: {error}',
    'settings.devBy': 'developed by {name}',
    'settings.showContact': 'Show contact',
  },
)
