/**
 * Seed: legt beim ersten Start einen Admin-Benutzer an, falls noch keiner existiert.
 * Passwort aus ADMIN_PASSWORD (env); ist keins gesetzt, wird eins erzeugt und
 * einmalig ins Log geschrieben, damit es abgeholt und danach geaendert werden kann.
 */
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from './db/index.js'
import { users } from './db/schema.js'
import { hashPassword } from './lib/password.js'

export async function seedAdmin(): Promise<void> {
  const count = (await db.select({ n: sql<number>`count(*)::int` }).from(users))[0]?.n ?? 0
  if (count > 0) return

  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url')
  await db.insert(users).values({
    username,
    role: 'admin',
    passwordHash: await hashPassword(password),
  })

  console.log('┌──────────────────────────────────────────────┐')
  console.log('│  INITIALER ADMIN-BENUTZER ANGELEGT             │')
  console.log(`│  Benutzer: ${username}`)
  console.log(`│  Passwort: ${password}`)
  console.log('│  -> Nach dem ersten Login ändern!             │')
  console.log('└──────────────────────────────────────────────┘')
}
