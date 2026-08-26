/**
 * Datenmodell (PostgreSQL via Drizzle ORM)
 *
 * Bildet die Xibo-Begriffswelt ab, damit geschulte Mitarbeiter sich sofort zurechtfinden:
 * Benutzer · Medien · Layouts → Regionen → Playlists → Widgets · Kampagnen ·
 * Displays / Display-Gruppen · Zeitpläne (mit Dayparting/Priorität) · Kommandos ·
 * Proof-of-Play & Betriebs-Logs (Observability).
 */
import {
  pgTable, uuid, text, integer, boolean, timestamp, jsonb, real,
  pgEnum, uniqueIndex, index, primaryKey, serial,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
// Rollen: 'grafik' (Display-Inhalte) und 'admin' (alles + Benutzer). operator/viewer bleiben
// aus Kompatibilität im Enum, werden aber nicht mehr vergeben.
export const userRole = pgEnum('user_role', ['admin', 'operator', 'viewer', 'grafik'])
export const authSource = pgEnum('auth_source', ['local', 'ad'])
export const mediaType = pgEnum('media_type', ['image', 'video', 'audio', 'pdf', 'font'])
export const layoutStatus = pgEnum('layout_status', ['draft', 'published', 'archived'])
export const widgetType = pgEnum('widget_type', [
  'image', 'video', 'audio', 'pdf',        // Medien-Widgets
  'text', 'clock', 'weather', 'rss',       // Daten-Widgets
  'webpage', 'embedded_html',              // Web-Widgets
  'icinga',                                // Monitoring (Icinga-2-API, serverseitig geholt)
])
export const displayStatus = pgEnum('display_status', ['online', 'offline', 'pending'])
export const scheduleType = pgEnum('schedule_type', ['layout', 'campaign', 'overlay', 'command'])
export const logLevel = pgEnum('log_level', ['debug', 'info', 'warn', 'error'])

// ---------------------------------------------------------------------------
// Benutzer & Auth
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull(),
  email: text('email'),
  passwordHash: text('password_hash'),                 // null bei AD-Nutzern (Passwort liegt im AD)
  authSource: authSource('auth_source').notNull().default('local'),
  role: userRole('role').notNull().default('grafik'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  usernameUq: uniqueIndex('users_username_uq').on(t.username),
}))

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenUq: uniqueIndex('sessions_token_uq').on(t.tokenHash),
  userIdx: index('sessions_user_idx').on(t.userId),
}))

// ---------------------------------------------------------------------------
// Medienbibliothek
// ---------------------------------------------------------------------------
export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: mediaType('type').notNull(),
  storageKey: text('storage_key').notNull(),          // relativer Pfad im Media-Volume
  originalFilename: text('original_filename'),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  md5: text('md5'),                                   // für Client-Cache-Abgleich
  width: integer('width'),
  height: integer('height'),
  durationSeconds: real('duration_seconds'),          // Video/Audio-Länge bzw. Default-Standzeit
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  tags: jsonb('tags').$type<string[]>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  md5Idx: index('media_md5_idx').on(t.md5),
  typeIdx: index('media_type_idx').on(t.type),
}))

// ---------------------------------------------------------------------------
// Layouts → Regionen → Playlists → Widgets
// ---------------------------------------------------------------------------
export const layouts = pgTable('layouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  width: integer('width').notNull().default(1920),
  height: integer('height').notNull().default(1080),
  backgroundColor: text('background_color').notNull().default('#000000'),
  backgroundMediaId: uuid('background_media_id').references(() => media.id, { onDelete: 'set null' }),
  status: layoutStatus('status').notNull().default('draft'),
  publishedVersion: integer('published_version').notNull().default(0),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const regions = pgTable('regions', {
  id: uuid('id').primaryKey().defaultRandom(),
  layoutId: uuid('layout_id').notNull().references(() => layouts.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Region'),
  x: real('x').notNull().default(0),
  y: real('y').notNull().default(0),
  width: real('width').notNull(),
  height: real('height').notNull(),
  zIndex: integer('z_index').notNull().default(0),
  loop: boolean('loop').notNull().default(true),
  transition: text('transition').notNull().default('none'),   // none|fade|slide
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  layoutIdx: index('regions_layout_idx').on(t.layoutId),
}))

export const playlists = pgTable('playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default('Playlist'),
  regionId: uuid('region_id').references(() => regions.id, { onDelete: 'cascade' }), // null = globale/wiederverwendbare Playlist
  isDynamic: boolean('is_dynamic').notNull().default(false),
  filter: jsonb('filter').$type<Record<string, unknown>>(),   // Tag-Filter für dynamische Playlists
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  regionIdx: index('playlists_region_idx').on(t.regionId),
}))

export const widgets = pgTable('widgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  playlistId: uuid('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  type: widgetType('type').notNull(),
  name: text('name'),
  mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }), // für Medien-Widgets
  durationSeconds: integer('duration_seconds').notNull().default(10),
  useMediaDuration: boolean('use_media_duration').notNull().default(false),
  orderIndex: integer('order_index').notNull().default(0),
  options: jsonb('options').$type<Record<string, unknown>>().default({}), // modul-spezifisch (Text, URL, RSS-Feed, Ort ...)
  fromDt: timestamp('from_dt', { withTimezone: true }),   // optionale Widget-Gültigkeit
  toDt: timestamp('to_dt', { withTimezone: true }),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  playlistOrderIdx: index('widgets_playlist_order_idx').on(t.playlistId, t.orderIndex),
}))

// ---------------------------------------------------------------------------
// Kampagnen (geordnete Layout-Folgen)
// ---------------------------------------------------------------------------
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const campaignLayouts = pgTable('campaign_layouts', {
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  layoutId: uuid('layout_id').notNull().references(() => layouts.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.campaignId, t.layoutId] }),
}))

// ---------------------------------------------------------------------------
// Displays & Display-Gruppen
// ---------------------------------------------------------------------------
export const displays = pgTable('displays', {
  id: uuid('id').primaryKey().defaultRandom(),
  hardwareKey: text('hardware_key').notNull(),        // eindeutige Client-ID (Electron erzeugt)
  pairingCode: text('pairing_code'),                  // 6-stelliger Code für Erst-Kopplung
  name: text('name').notNull(),
  description: text('description'),
  authorized: boolean('authorized').notNull().default(false),
  status: displayStatus('status').notNull().default('pending'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  /**
   * SHA-256 des Geraete-Geheimnisses. Der hardwareKey (Rechnername) ist im AD aufzaehlbar
   * und taugt daher NICHT als Nachweis. Ist hier ein Wert gesetzt, muss das Geraet ihn bei
   * jedem Zugriff mitliefern. NULL = Altgeraet ohne Geheimnis (laeuft weiter wie bisher,
   * bis es einmal mit Geheimnis erscheint - dann wird es gebunden).
   */
  deviceSecretHash: text('device_secret_hash'),
  defaultLayoutId: uuid('default_layout_id').references(() => layouts.id, { onDelete: 'set null' }),
  resolutionW: integer('resolution_w'),
  resolutionH: integer('resolution_h'),
  timezone: text('timezone').default('Europe/Berlin'),
  macAddress: text('mac_address'),
  ipAddress: text('ip_address'),
  clientVersion: text('client_version'),
  // Sofort-Einblendung (Notfall-Overlay): { text, subtext?, color?, background?, until? } oder null
  override: jsonb('override').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hardwareKeyUq: uniqueIndex('displays_hardware_key_uq').on(t.hardwareKey),
  statusIdx: index('displays_status_idx').on(t.status),
}))

export const displayGroups = pgTable('display_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const displayGroupMembers = pgTable('display_group_members', {
  groupId: uuid('group_id').notNull().references(() => displayGroups.id, { onDelete: 'cascade' }),
  displayId: uuid('display_id').notNull().references(() => displays.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.groupId, t.displayId] }),
}))

// ---------------------------------------------------------------------------
// Zeitpläne (mit Dayparting, Priorität, Wiederholung)
// ---------------------------------------------------------------------------
export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: scheduleType('type').notNull().default('layout'),
  layoutId: uuid('layout_id').references(() => layouts.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
  commandId: uuid('command_id').references((): any => commands.id, { onDelete: 'cascade' }),
  // Ziel: entweder einzelnes Display oder Gruppe
  displayId: uuid('display_id').references(() => displays.id, { onDelete: 'cascade' }),
  displayGroupId: uuid('display_group_id').references(() => displayGroups.id, { onDelete: 'cascade' }),
  fromDt: timestamp('from_dt', { withTimezone: true }).notNull(),
  toDt: timestamp('to_dt', { withTimezone: true }),
  priority: integer('priority').notNull().default(0),  // höher gewinnt bei Überschneidung
  isOverlay: boolean('is_overlay').notNull().default(false),
  // Wiederholung/Dayparting: { freq:'daily'|'weekly', byDay:[0..6], startTime:'HH:MM', endTime:'HH:MM' }
  recurrence: jsonb('recurrence').$type<Record<string, unknown>>(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  fromIdx: index('schedules_from_idx').on(t.fromDt),
  displayIdx: index('schedules_display_idx').on(t.displayId),
  groupIdx: index('schedules_group_idx').on(t.displayGroupId),
}))

// ---------------------------------------------------------------------------
// Kommandos (Remote-Steuerung: Reboot, Screenshot, Reload ...)
// ---------------------------------------------------------------------------
export const commands = pgTable('commands', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  code: text('code').notNull(),                        // z.B. REBOOT, SCREENSHOT, RELOAD
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codeUq: uniqueIndex('commands_code_uq').on(t.code),
}))

// ---------------------------------------------------------------------------
// Observability: Proof-of-Play, Betriebs-Logs, Audit
// ---------------------------------------------------------------------------
export const proofOfPlay = pgTable('proof_of_play', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayId: uuid('display_id').notNull().references(() => displays.id, { onDelete: 'cascade' }),
  layoutId: uuid('layout_id').references(() => layouts.id, { onDelete: 'set null' }),
  widgetId: uuid('widget_id').references(() => widgets.id, { onDelete: 'set null' }),
  mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationSeconds: real('duration_seconds'),
  count: integer('count').notNull().default(1),
}, (t) => ({
  displayTimeIdx: index('pop_display_time_idx').on(t.displayId, t.startedAt),
  mediaIdx: index('pop_media_idx').on(t.mediaId),
}))

export const displayLogs = pgTable('display_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayId: uuid('display_id').references(() => displays.id, { onDelete: 'cascade' }),
  level: logLevel('level').notNull().default('info'),
  code: text('code'),
  message: text('message').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  displayTimeIdx: index('display_logs_display_time_idx').on(t.displayId, t.createdAt),
  levelIdx: index('display_logs_level_idx').on(t.level),
}))

/**
 * Organisationsweite Einstellungen (Schluessel/Wert).
 * Erste Einstellung: `language` ('de' | 'en') — die Sprache der Oberflaeche gilt fuer die
 * gesamte Installation, NICHT pro Benutzer und NICHT pro Browser. Deutsch ist der Standard.
 * Weitere Einstellungen kommen als weitere Zeile dazu, ohne neue Migration.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
})

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),                    // create|update|delete|publish|schedule|command
  entity: text('entity').notNull(),                    // media|layout|display|schedule ...
  entityId: uuid('entity_id'),
  detail: jsonb('detail').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  entityIdx: index('audit_entity_idx').on(t.entity, t.entityId),
  timeIdx: index('audit_time_idx').on(t.createdAt),
}))

// ---------------------------------------------------------------------------
// Relations (für typsichere Joins)
// ---------------------------------------------------------------------------
export const layoutsRelations = relations(layouts, ({ many, one }) => ({
  regions: many(regions),
  backgroundMedia: one(media, { fields: [layouts.backgroundMediaId], references: [media.id] }),
}))
export const regionsRelations = relations(regions, ({ one, many }) => ({
  layout: one(layouts, { fields: [regions.layoutId], references: [layouts.id] }),
  playlists: many(playlists),
}))
export const playlistsRelations = relations(playlists, ({ one, many }) => ({
  region: one(regions, { fields: [playlists.regionId], references: [regions.id] }),
  widgets: many(widgets),
}))
export const widgetsRelations = relations(widgets, ({ one }) => ({
  playlist: one(playlists, { fields: [widgets.playlistId], references: [playlists.id] }),
  media: one(media, { fields: [widgets.mediaId], references: [media.id] }),
}))
export const displaysRelations = relations(displays, ({ one }) => ({
  defaultLayout: one(layouts, { fields: [displays.defaultLayoutId], references: [layouts.id] }),
}))

/**
 * Verlauf der offenen Monitoring-Meldungen (alle ~30 s ein Punkt).
 * BEWUSST in der Datenbank statt im Arbeitsspeicher: der Verlauf soll einen Neustart des
 * CMS ueberleben - sonst zeigt das Wallboard nach jedem Deploy wieder "wird aufgebaut"
 * und ist damit wertlos. Ein Punkt ist winzig, aelter als 24 h wird automatisch geloescht.
 */
export const icingaHistory = pgTable('icinga_history', {
  id: serial('id').primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  problems: integer('problems').notNull().default(0),
  critical: integer('critical').notNull().default(0),
  warning: integer('warning').notNull().default(0),
  down: integer('down').notNull().default(0),
}, (t) => ({ atIdx: index('icinga_history_at_idx').on(t.at) }))
