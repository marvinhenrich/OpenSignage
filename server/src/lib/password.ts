/**
 * Passwort-Hashing mit scrypt (aus node:crypto, keine externe Abhängigkeit).
 * Format: scrypt$<N>$<saltHex>$<hashHex>
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const N = 16384 // CPU/Memory-Kostenfaktor
const KEYLEN = 64

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) =>
      err ? reject(err) : resolve(derivedKey as Buffer))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = (await scryptAsync(password, salt, KEYLEN, { N })) as Buffer
  return `scrypt$${N}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const salt = Buffer.from(parts[2], 'hex')
  const expected = Buffer.from(parts[3], 'hex')
  const derived = (await scryptAsync(password, salt, expected.length, { N: n })) as Buffer
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}
