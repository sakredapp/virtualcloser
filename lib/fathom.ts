// Fathom integration helpers.
//
// Fathom (fathom.video) records meetings and can webhook us when a recording
// is ready. We use it to auto-generate a custom build plan for prospects /
// new paying customers based on what was discussed.
//
// Two ways to receive a recording:
//   1. Fathom Pro/Team can configure outbound webhooks pointing at
//      /api/webhooks/fathom. Payload includes attendees, summary, transcript.
//   2. Manual paste of a Fathom share URL into the admin UI; we fetch via
//      the public oEmbed-style endpoint.
//
// Matching: by attendee email → prospects (lookup case-insensitive). If
// the attendee email is yours (you're the host), skip — match the OTHER
// attendees.
//
// Auth: webhooks verified two ways (either is sufficient):
//   • HMAC-SHA256 of the raw body using FATHOM_WEBHOOK_SECRET, compared
//     against a signature header (Fathom's exact header name varies; we
//     try the common ones).
//   • Shared secret in the URL ?token= param (FATHOM_PROSPECT_WEBHOOK_TOKEN).
//
// API access: FATHOM_API_KEY enables fetchTranscriptById(...) for cases
// where the webhook payload omits the full transcript.

import crypto from 'node:crypto'

export type FathomMeeting = {
  id: string
  title?: string | null
  startedAt?: string | null      // ISO
  durationSec?: number | null
  recordingUrl?: string | null
  transcriptUrl?: string | null
  shareUrl?: string | null
  summary?: string | null        // AI-generated summary from Fathom
  transcript?: string | null     // full transcript text (when available)
  actionItems?: string[]
  attendees: { name?: string | null; email?: string | null }[]
}

const HOST_EMAILS = (process.env.FATHOM_HOST_EMAILS ?? process.env.ADMIN_NOTIFY_EMAIL ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

/** Pick the first non-host attendee — the lead/prospect. */
export function pickProspectAttendee(meeting: FathomMeeting): { email: string; name: string | null } | null {
  for (const a of meeting.attendees ?? []) {
    const email = (a.email ?? '').toLowerCase().trim()
    if (!email) continue
    if (HOST_EMAILS.includes(email)) continue
    return { email, name: a.name ?? null }
  }
  return null
}

// ── Signature verification ──────────────────────────────────────────────

/** Headers Fathom is known (or likely) to use for webhook signatures.
 *  We accept any match — Fathom hasn't kept this consistent across
 *  product updates. Empty by default (no list shipped); driven by env
 *  if needed. */
const SIG_HEADERS = [
  'x-fathom-signature',
  'x-fathom-webhook-signature',
  'x-webhook-signature',
  'x-signature',
  'fathom-signature',
]

/** Returns true if the request signature is valid against the secret, OR
 *  the URL token matches. Either is sufficient — defense in depth. */
export function verifyFathomRequest(args: {
  rawBody: string
  headers: Headers
  url: string
  secret: string | undefined
  expectedToken: string | undefined
}): { valid: boolean; method: 'hmac' | 'token' | 'none' } {
  // Token check first — fast and matches our setup default.
  if (args.expectedToken) {
    try {
      const u = new URL(args.url)
      const t = u.searchParams.get('token') ?? args.headers.get('x-webhook-token')
      if (t && safeEquals(t, args.expectedToken)) return { valid: true, method: 'token' }
    } catch {
      // ignore parse errors; fall through to HMAC
    }
  }

  // HMAC fallback. We try both hex and base64 encodings against any
  // header that might carry the signature. Fathom's exact format isn't
  // publicly documented; this absorbs the common shapes.
  if (args.secret) {
    const h = (name: string) => args.headers.get(name)
    let received: string | null = null
    for (const name of SIG_HEADERS) {
      const v = h(name)
      if (v) { received = v.trim(); break }
    }
    if (received) {
      // Strip "sha256=" prefix if present.
      const cleaned = received.replace(/^sha256=/i, '').trim()
      const hmacHex = crypto.createHmac('sha256', args.secret).update(args.rawBody).digest('hex')
      const hmacB64 = crypto.createHmac('sha256', args.secret).update(args.rawBody).digest('base64')
      if (safeEquals(cleaned, hmacHex) || safeEquals(cleaned, hmacB64)) {
        return { valid: true, method: 'hmac' }
      }
    }
  }

  return { valid: false, method: 'none' }
}

function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// ── API client ──────────────────────────────────────────────────────────

const FATHOM_API_BASE = process.env.FATHOM_API_BASE ?? 'https://api.fathom.video/v1'

/** Fetch the full transcript for a meeting via the Fathom API. Returns
 *  a plain-text transcript or null if unavailable. */
export async function fetchTranscriptById(meetingId: string): Promise<string | null> {
  const apiKey = process.env.FATHOM_API_KEY
  if (!apiKey) {
    console.warn('[fathom] FATHOM_API_KEY not set; cannot fetch transcript')
    return null
  }
  // Fathom's REST surface has shifted between releases — try a couple of
  // common endpoints. We attempt the most-likely first, then fall back.
  const endpoints = [
    `${FATHOM_API_BASE}/meetings/${encodeURIComponent(meetingId)}/transcript`,
    `${FATHOM_API_BASE}/recordings/${encodeURIComponent(meetingId)}/transcript`,
    `${FATHOM_API_BASE}/meetings/${encodeURIComponent(meetingId)}`,
  ]
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { 'X-Api-Key': apiKey, 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
      })
      if (!res.ok) continue
      const ct = res.headers.get('content-type') ?? ''
      if (ct.startsWith('text/plain')) return await res.text()
      const json = await res.json() as Record<string, unknown>
      const t =
        (json.transcript as string | undefined) ??
        (json.text as string | undefined) ??
        (typeof json === 'object' && (json as { meeting?: { transcript?: string } }).meeting?.transcript) ??
        null
      if (typeof t === 'string' && t.length > 0) return t
    } catch (err) {
      console.warn('[fathom] transcript fetch failed', url, err)
    }
  }
  return null
}

/** Normalize whatever Fathom's webhook payload shape is into FathomMeeting.
 *  Fathom doesn't ship a stable schema — we accept several common keys
 *  to absorb variations and avoid silent breakage. */
export function normalizeFathomPayload(raw: Record<string, unknown>): FathomMeeting | null {
  const meeting = (raw.meeting ?? raw.recording ?? raw) as Record<string, unknown>
  if (!meeting) return null
  const id = (meeting.id ?? meeting.meeting_id ?? meeting.recording_id) as string | undefined
  if (!id) return null

  const attendeesRaw = (meeting.attendees ?? meeting.participants ?? raw.attendees ?? []) as unknown[]
  const attendees = attendeesRaw
    .map((p) => {
      if (!p || typeof p !== 'object') return null
      const o = p as Record<string, unknown>
      return {
        name: (o.name ?? o.display_name ?? null) as string | null,
        email: (o.email ?? o.email_address ?? null) as string | null,
      }
    })
    .filter((p): p is { name: string | null; email: string | null } => p !== null)

  const transcriptText = (meeting.transcript ?? meeting.transcript_text ?? null) as string | null

  return {
    id,
    title: (meeting.title ?? meeting.subject ?? null) as string | null,
    startedAt: (meeting.started_at ?? meeting.start_time ?? null) as string | null,
    durationSec: (meeting.duration_sec ?? meeting.duration_seconds ?? null) as number | null,
    recordingUrl: (meeting.recording_url ?? meeting.video_url ?? null) as string | null,
    transcriptUrl: (meeting.transcript_url ?? null) as string | null,
    shareUrl: (meeting.share_url ?? meeting.url ?? null) as string | null,
    summary: (meeting.summary ?? meeting.ai_summary ?? null) as string | null,
    transcript: transcriptText,
    actionItems: (meeting.action_items ?? meeting.actionItems ?? []) as string[],
    attendees,
  }
}
