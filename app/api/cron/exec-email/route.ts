import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { listMembers } from '@/lib/members'
import { sendEmail } from '@/lib/email'
import { buildExecDigest } from '@/lib/exec/digest'
import { buildPinnacleBriefData, generateExecSummary } from '@/lib/exec/summary'
import { renderExecEmail, type DigestMode } from '@/lib/exec/emailDigest'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { getBrand, type BrandKey } from '@/lib/brand'
import type { Member } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Formal executive email digest — CXO Suite only. Companion to the Telegram
 * exec-brief: the brief is the quick daily read; this is the polished email.
 *
 * Cron fires hourly Mon-Fri; sends at 7am local. Monday = a fuller "weekly"
 * framing, other weekdays = compact "daily". Recipients are owner/admin members
 * who opted in (settings.exec_email_digest === true); Pinnacle-viewer tenants
 * (Spencer) are opted in by default and get the revenue block. Non-Pinnacle
 * tenants never see revenue.
 */

const SEND_LOCAL_HOUR = 7

function localParts(tz: string, ref: Date = new Date()): { hour: number; weekday: string } {
  try {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(ref),
    )
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(ref)
    return { hour, weekday }
  } catch {
    return { hour: ref.getUTCHours(), weekday: 'Mon' }
  }
}

async function emailTenant(tenant: Tenant, force: boolean): Promise<number> {
  const tz = tenant.timezone || 'America/New_York'
  const { hour, weekday } = localParts(tz)
  if (!force && hour !== SEND_LOCAL_HOUR) return 0
  const mode: DigestMode = weekday === 'Mon' ? 'weekly' : 'daily'

  const pinnacleViewer = isPinnacleViewer(tenant.id)
  const members = await listMembers(tenant.id)
  const recipients = members.filter((m: Member) => {
    if (!m.is_active || !m.email) return false
    if (m.role !== 'owner' && m.role !== 'admin') return false
    const optedIn = (m.settings as Record<string, unknown> | undefined)?.exec_email_digest === true
    return optedIn || pinnacleViewer
  })
  if (recipients.length === 0) return 0

  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const pinnacle = pinnacleViewer ? await buildPinnacleBriefData(todayIso).catch(() => null) : null

  const brandKey = ((tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const bc = getBrand(brandKey)
  // CXO digests render on vanilla canvas with cream-vanilla AI-summary card
  // and charcoal ink — the whole email reads as CXO, not just the accent
  // strip. VC stays on the digest's built-in defaults (#FDFDFB / #0f0f0f /
  // #6B7280 / #E5E5E5) so the VC visual is byte-for-byte identical.
  const emailBrand =
    brandKey === 'cxo'
      ? {
          name: bc.name,
          logoSrc: bc.logo.wordmarkSrc,
          accent: bc.theme.accent,
          bg: bc.theme.bg,           // vanilla #FAF7F0
          ink: bc.theme.ink,         // charcoal #2A2A2A
          paper2: bc.theme.paper2,   // cream-vanilla #EFEAE0
          // Keep the digest's default muted/border so meta text and dividers
          // stay readable on cream — CXO's theme.muted (#555) is fine for
          // body copy but reads too heavy as 11px label text in email.
        }
      : { name: bc.name, logoSrc: bc.logo.wordmarkSrc, accent: bc.theme.accent }

  let sent = 0
  for (const m of recipients) {
    try {
      const digest = await buildExecDigest(tenant, { memberId: m.id, timezone: m.timezone || tz })
      const aiSummary = await generateExecSummary({
        digest,
        pinnacle,
        name: m.display_name || 'there',
        claudeKey: tenant.claude_api_key,
      }).catch(() => '')
      const { subject, html, text } = renderExecEmail({
        digest,
        pinnacle,
        aiSummary,
        name: m.display_name || 'there',
        timezone: m.timezone || tz,
        mode,
        brand: emailBrand,
      })
      const res = await sendEmail({ to: m.email, subject, html, text, brand: brandKey })
      if (res.ok) sent++
    } catch (err) {
      console.error('[exec-email] failed for member', m.id, err)
    }
  }
  return sent
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const force = req.nextUrl.searchParams.get('force') === '1'
  const tenants = await getAllActiveTenants()
  const cxoTenants = tenants.filter((t) => ((t as { brand?: BrandKey }).brand ?? 'virtualcloser') === 'cxo')

  let totalSent = 0
  const results: Array<{ slug: string; sent: number }> = []
  for (const tenant of cxoTenants) {
    try {
      const sent = await emailTenant(tenant, force)
      if (sent > 0) results.push({ slug: tenant.slug, sent })
      totalSent += sent
    } catch (err) {
      console.error('[exec-email] tenant failed', tenant.slug, err)
    }
  }
  return NextResponse.json({ ok: true, cxoTenants: cxoTenants.length, totalSent, results })
}
