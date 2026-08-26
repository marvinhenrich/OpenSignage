/**
 * Session-Handling: Zufalls-Token beim Login, in der DB wird nur der SHA-256-Hash
 * gespeichert. Cookie "sid" (httpOnly). Kein JWT — serverseitig widerrufbar.
 */
import { createHash, randomBytes } from 'node:crypto'

export const SESSION_COOKIE = 'sid'
export const SESSION_TTL_DAYS = 7

export function newSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
}
