/**
 * Active-Directory-Authentifizierung per LDAP-Bind (ldapts).
 * UPN-Bind (kein Service-Konto nötig): bindet als <user>@<suffix> gegen die DCs.
 * Mehrere Domaincontroller mit Failover; LDAPS (Port 636).
 *
 * Konfiguration (env):
 *   AD_DCS                    "dc01.example.com;dc02.example.com"
 *   AD_PORT                   636
 *   AD_USE_SSL                true  -> ldaps://
 *   AD_UPN_SUFFIX             "@example.local"
 *   AD_TLS_REJECT_UNAUTHORIZED false -> interne/self-signed AD-Zertifikate akzeptieren
 */
import { Client, InvalidCredentialsError } from 'ldapts'

export type AdResult =
  | { ok: true }
  | { ok: false; reason: 'credentials' }
  | { ok: false; reason: 'unreachable'; detail: string }

function dcUrls(): string[] {
  const dcs = (process.env.AD_DCS ?? '').split(/[;,]/).map((s) => s.trim()).filter(Boolean)
  const port = process.env.AD_PORT ?? '636'
  const scheme = (process.env.AD_USE_SSL ?? 'true').toLowerCase() === 'true' ? 'ldaps' : 'ldap'
  return dcs.map((h) => `${scheme}://${h}:${port}`)
}

export function adConfigured(): boolean {
  return dcUrls().length > 0
}

export async function authenticateAD(username: string, password: string): Promise<AdResult> {
  if (!password) return { ok: false, reason: 'credentials' }
  const suffix = process.env.AD_UPN_SUFFIX ?? ''
  const upn = username.includes('@') ? username : `${username}${suffix}`
  const rejectUnauthorized = (process.env.AD_TLS_REJECT_UNAUTHORIZED ?? 'false').toLowerCase() === 'true'

  const urls = dcUrls()
  let lastErr = 'kein Domaincontroller konfiguriert'

  for (const url of urls) {
    const client = new Client({ url, timeout: 8000, connectTimeout: 8000, tlsOptions: { rejectUnauthorized } })
    try {
      await client.bind(upn, password)
      return { ok: true }
    } catch (err) {
      if (err instanceof InvalidCredentialsError) return { ok: false, reason: 'credentials' }
      // Verbindungsfehler zu diesem DC -> nächsten versuchen
      lastErr = err instanceof Error ? err.message : String(err)
    } finally {
      try { await client.unbind() } catch { /* egal */ }
    }
  }
  return { ok: false, reason: 'unreachable', detail: lastErr }
}
