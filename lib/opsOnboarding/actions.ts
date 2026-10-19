/**
 * The things Accounts may do to a Suite CXO client
 * (POST /api/ops/onboarding/actions):
 *
 *   create_client            the /admin/clients/new create, Suite CXO brand only:
 *                            reps row, owner member, <slug>.suitecxo.com in Vercel,
 *                            the "Your login is ready" email (lib/loginLinkSend)
 *   resend_login_link        the owner's login email (lib/onboardingOwner, which
 *                            creates the owner first if needed; 2-minute guard)
 *   issue_sign_and_pay_link  a fresh onboarding_tokens link (lib/admin-onboarding),
 *                            Whop checkout when there is a build fee
 *   activate_billing         email the owner a Whop seat checkout ($60 a seat a
 *                            month, max(1, max_seats) seats); the Whop webhook
 *                            marks the client active when it is paid
 *                            (lib/billing/cxoBillingActions)
 *   comp_billing             mark the client comped, nothing charged:
 *                            { amount_cents?, reason } (at most $10,000 waived)
 *
 * Refused, always: the two App Store review tenants (review demo), and any
 * tenant that is not Suite CXO (reps.brand <> 'cxo').
 */
import { supabase } from '@/lib/supabase'
import { addClientEvent, createClientRow, updateClientRow } from '@/lib/admin-db'
import { TIER_INFO } from '@/lib/onboarding'
import { addProjectDomain, vercelConfigured } from '@/lib/vercel'
import { createMember, logAuditEvent } from '@/lib/members'
import { hashPassword } from '@/lib/client-password'
import { generateNonce } from '@/lib/random'
import { sendOwnerLoginLink } from '@/lib/onboardingOwner'
import { createOnboardingToken } from '@/lib/admin-onboarding'
import { tenantDomain } from '@/lib/newClientBrand'
import { isStoreReviewTenant, STORE_REVIEW } from '@/lib/storeDemo'
import { compClient, sendSeatCheckout, type BillingResult } from '@/lib/billing/cxoBillingActions'
import { OPS_ACTION_IDS, type OpsActionId } from '@/lib/opsOnboarding/shared'

export type ActionResult = { status: number; body: Record<string, unknown> }

const SOURCE = 'Accounts'

const fail = (status: number, error: string, message: string): ActionResult => ({ status, body: { ok: false, error, message } })

/** The rep id the create form makes from a slug (same rule as /admin/clients/new). */
export const repIdForSlug = (slug: string) => `rep_${slug.replace(/-/g, '_')}`

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** A review demo is never acted on. Pure, so the route and the tests share it. */
export function refusesReviewDemo(repId: string | null | undefined): boolean {
  return isStoreReviewTenant(repId)
}

export function parseAction(raw: unknown): OpsActionId | null {
  return typeof raw === 'string' && (OPS_ACTION_IDS as readonly string[]).includes(raw) ? (raw as OpsActionId) : null
}

type CxoRep = { id: string; slug: string; display_name: string; email: string | null; build_fee: number | null; brand: string | null }

async function cxoRep(repId: string): Promise<CxoRep | null> {
  const { data } = await supabase.from('reps').select('id, slug, display_name, email, build_fee, brand').eq('id', repId).maybeSingle()
  const r = data as CxoRep | null
  return r && r.brand === 'cxo' ? r : null
}

export async function runOpsAction(body: Record<string, unknown>): Promise<ActionResult> {
  const action = parseAction(body.action)
  if (!action) return fail(400, 'bad_action', `action must be one of ${OPS_ACTION_IDS.join(', ')}.`)

  if (action === 'create_client') return createClient((body.input ?? body) as Record<string, unknown>)

  const repId = typeof body.rep_id === 'string' ? body.rep_id.trim() : ''
  if (!repId) return fail(400, 'rep_id_required', 'rep_id is required.')
  if (refusesReviewDemo(repId)) return fail(403, 'review_demo', 'This is an App Store review account. Nothing is ever done to it.')
  const rep = await cxoRep(repId)
  if (!rep) return fail(404, 'not_found', 'No Suite CXO client with that id.')

  if (action === 'resend_login_link') {
    const r = await sendOwnerLoginLink(rep.id, SOURCE)
    if (r.status === 'failed') return { status: 502, body: { ok: false, error: 'send_failed', message: r.error, rep_id: rep.id } }
    return { status: 200, body: { ok: true, rep_id: rep.id, result: r.status, email: r.email } }
  }

  if (action === 'activate_billing') {
    return billingResult(rep.id, await sendSeatCheckout(rep.id, { kind: 'admin', source: SOURCE }), 'Whop seat checkout sent')
  }

  if (action === 'comp_billing') {
    const r = await compClient(rep.id, body.amount_cents, body.reason, { kind: 'admin', source: SOURCE })
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : ''
    return billingResult(rep.id, r, `Comped, nothing charged (${reason})`)
  }

  // issue_sign_and_pay_link
  const feeRaw = body.build_fee
  const buildFee = feeRaw === undefined || feeRaw === null || feeRaw === '' ? rep.build_fee : Number(feeRaw)
  if (buildFee !== null && (!Number.isFinite(buildFee) || buildFee < 0 || buildFee > 1_000_000)) {
    return fail(400, 'bad_build_fee', 'build_fee must be a dollar amount from 0 to 1,000,000.')
  }
  const r = await createOnboardingToken({ id: rep.id, display_name: rep.display_name, email: rep.email, build_fee: buildFee, brand: 'cxo' })
  if (!r.ok) return { status: 502, body: { ok: false, error: 'issue_failed', message: r.error, rep_id: rep.id } }
  try {
    await addClientEvent({ repId: rep.id, kind: 'billing', title: `Sign-and-pay link issued from ${SOURCE}` })
  } catch {
    /* timeline is best effort */
  }
  return { status: 200, body: { ok: true, rep_id: rep.id, url: r.url, build_fee: buildFee ?? 0 } }
}

/** Mirrors the /admin/clients/new create for the Suite CXO brand. */
async function createClient(input: Record<string, unknown>): Promise<ActionResult> {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '')
  const slug = str('slug').toLowerCase()
  const display_name = str('display_name')
  const email = str('email').toLowerCase()
  const company = str('company') || undefined
  const tier = str('tier') === 'enterprise' ? 'enterprise' : 'individual'
  const timezone = str('timezone') || 'America/New_York'
  const sendWelcome = input.send_welcome !== false
  const issueLink = input.issue_sign_and_pay_link === true

  if (!slug || !SLUG_RE.test(slug) || slug.length > 40) return fail(400, 'bad_slug', 'slug must be lowercase letters, digits and dashes.')
  if (!display_name) return fail(400, 'display_name_required', 'display_name is required.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'bad_email', 'A valid owner email is required.')

  const id = repIdForSlug(slug)
  if (refusesReviewDemo(id) || Object.values(STORE_REVIEW).some((r) => r === id)) {
    return fail(403, 'review_demo', 'That id belongs to an App Store review account.')
  }
  const num = (k: string, dflt: number) => {
    const v = input[k]
    if (v === undefined || v === null || v === '') return dflt
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : NaN
  }
  const monthly_fee = num('monthly_fee', TIER_INFO[tier].monthly)
  const build_fee = num('build_fee', TIER_INFO[tier].build[0])
  if (Number.isNaN(monthly_fee) || Number.isNaN(build_fee)) return fail(400, 'bad_fee', 'monthly_fee and build_fee must be non-negative numbers.')
  const maxSeatsRaw = num('max_seats', 0)
  const maxSeats = tier === 'enterprise' && maxSeatsRaw > 0 ? Math.max(1, Math.min(10000, Math.floor(maxSeatsRaw))) : null

  const { data: existing } = await supabase.from('reps').select('id').or(`id.eq.${id},slug.eq.${slug}`).limit(1)
  if ((existing ?? []).length) return fail(409, 'exists', 'A client with that slug already exists.')

  try {
    await createClientRow({ id, slug, display_name, email, company, tier, monthly_fee, build_fee, timezone })
  } catch (err) {
    return fail(500, 'create_failed', err instanceof Error ? err.message : String(err))
  }

  // Suite CXO owners never get a password by email: an unusable random hash;
  // they set their own from the login link.
  const ownerHash = await hashPassword(generateNonce(32))
  await updateClientRow(id, { password_hash: ownerHash, brand: 'cxo', ...(maxSeats !== null ? { max_seats: maxSeats } : {}) } as Parameters<typeof updateClientRow>[1])

  let ownerCreated = false
  try {
    const owner = await createMember({ repId: id, email, displayName: display_name, role: 'owner', passwordHash: ownerHash, timezone })
    ownerCreated = true
    await logAuditEvent({ repId: id, memberId: null, action: 'member.invite', entityType: 'member', entityId: owner.id, diff: { email, role: 'owner', source: 'ops_accounts' } })
  } catch (err) {
    console.error('[ops/onboarding] owner create failed', err)
  }

  const domain = tenantDomain(slug, 'cxo')
  let domainResult: { ok: boolean; already?: boolean; error?: string } = { ok: false, error: 'vercel not configured' }
  if (vercelConfigured()) {
    const r = await addProjectDomain(domain)
    domainResult = r.ok ? { ok: true, already: !!r.alreadyExists } : { ok: false, error: r.error }
    try {
      await addClientEvent({
        repId: id,
        kind: 'integration',
        title: r.ok ? `Vercel domain ${domain} ${r.alreadyExists ? 'already attached' : 'added'} (${SOURCE})` : `Vercel auto-add FAILED for ${domain}: ${r.error}`,
      })
    } catch {
      /* best effort */
    }
  }

  let login: string = 'not_sent'
  if (sendWelcome) {
    try {
      login = (await sendOwnerLoginLink(id, SOURCE)).status
    } catch (err) {
      console.error('[ops/onboarding] login link failed', err)
      login = 'failed'
    }
  }

  let signAndPay: { ok: boolean; url?: string; error?: string } | null = null
  if (issueLink) {
    const r = await createOnboardingToken({ id, display_name, email, build_fee, brand: 'cxo' })
    signAndPay = r.ok ? { ok: true, url: r.url } : { ok: false, error: r.error }
  }

  return {
    status: 201,
    body: { ok: true, rep_id: id, slug, host: domain, owner_created: ownerCreated, domain: domainResult, login_link: login, sign_and_pay: signAndPay },
  }
}

/** The billing actions answer `{ ok, error, message }` with the rep id, like the others. */
async function billingResult(repId: string, r: BillingResult, title: string): Promise<ActionResult> {
  if (!r.ok) return { status: r.status, body: { ok: false, error: r.error, message: r.message, rep_id: repId } }
  try {
    await addClientEvent({ repId, kind: 'billing', title: `${title} from ${SOURCE}` })
  } catch {
    /* timeline is best effort */
  }
  return { status: r.status, body: { ok: true, rep_id: repId, ...r.data } }
}
