// Private-server fleet check-ins (selfhost/): a client box's health agent posts
// its status to app/api/ops/private-server/report every minute, signed with the
// box's own licence (Authorization: Bearer <licence line>). The licence proves
// which box it is: only Suite CXO can sign one, and it names the box. An
// expired licence still reports, so we see a lapsed box instead of losing it.
// No new secret: the box already holds its licence; nothing else is needed.
import { verifyLicence, type LicencePayload } from '../selfhost/licence/licence.mjs'

export type BoxCheck = { name: string; ok: boolean; ms?: number; detail?: string; error?: string }

export type BoxReportRow = {
  box_id: string
  client_id: string
  client_name: string
  seats: number
  licence_expires_at: string
  status: 'ok' | 'failing'
  failing_checks: string[]
  last_report: { at: string | null; ok: boolean; checks: BoxCheck[]; licence_expired: boolean }
  last_seen_at: string
  last_ok_at?: string
}

export type ParsedReport = { ok: true; row: BoxReportRow } | { ok: false; status: number; error: string }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)

/**
 * Check the bearer licence and the body, and build the fleet row. Pure: the
 * route does the upsert. `publicKeyPem` is for tests; boxes use the shipped key.
 */
export function parseBoxReport(
  authorization: string | null,
  body: unknown,
  { now = Date.now(), publicKeyPem }: { now?: number; publicKeyPem?: string } = {},
): ParsedReport {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return { ok: false, status: 401, error: 'no_licence' }
  const v = verifyLicence(token, { now, ...(publicKeyPem ? { publicKeyPem } : {}) })
  const licence: LicencePayload | undefined = v.ok ? v.licence : v.expired ? v.licence : undefined
  if (!licence) return { ok: false, status: 401, error: 'bad_licence' }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'bad_json' }
  const b = body as Record<string, unknown>
  if (b.box !== licence.box_id) return { ok: false, status: 403, error: 'box_mismatch' }
  if (!Array.isArray(b.checks)) return { ok: false, status: 400, error: 'no_checks' }

  const checks: BoxCheck[] = b.checks.slice(0, 20).flatMap((c) => {
    if (!c || typeof c !== 'object') return []
    const r = c as Record<string, unknown>
    const name = str(r.name, 60)
    if (!name) return []
    return [{
      name,
      ok: r.ok === true,
      ...(typeof r.ms === 'number' && Number.isFinite(r.ms) ? { ms: Math.round(r.ms) } : {}),
      ...(str(r.detail, 200) ? { detail: str(r.detail, 200) } : {}),
      ...(str(r.error, 300) ? { error: str(r.error, 300) } : {}),
    }]
  })
  const failing = checks.filter((c) => !c.ok).map((c) => c.name)
  const allOk = b.ok === true && failing.length === 0 && checks.length > 0
  const seen = new Date(now).toISOString()
  const at = str(b.at, 40)

  return {
    ok: true,
    row: {
      box_id: licence.box_id,
      client_id: licence.client_id,
      client_name: licence.client_name,
      seats: licence.seats,
      licence_expires_at: licence.expires_at,
      status: allOk ? 'ok' : 'failing',
      failing_checks: failing,
      last_report: { at: at && !Number.isNaN(Date.parse(at)) ? at : null, ok: allOk, checks, licence_expired: !v.ok },
      last_seen_at: seen,
      ...(allOk ? { last_ok_at: seen } : {}),
    },
  }
}
