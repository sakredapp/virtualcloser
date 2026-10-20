/**
 * The agreement wall, checked on the server (task 2026-10-20 "Suite CXO
 * Agreement Wall Fail Closed and Server Checked").
 *
 * Every member signs the Operational & Liability Agreement as themselves
 * before they use the product. The dashboard draws the sign screen
 * (app/dashboard/layout.tsx), and every way into Ciao checks it too:
 * /api/mira/ask, /api/daily-queue (web + phone app), Slack
 * (lib/slack/handle.ts) and /api/mcp (lib/mcp/server.ts).
 *
 * Fails CLOSED: a lookup error never counts as signed.
 *
 * Who signs: the person at the keyboard. An assistant working as their exec
 * is checked on their own signature (member.acting_assistant), never the
 * exec's. The two store review logins skip the wall (lib/storeDemo.ts):
 * nobody signs a legal agreement on a reviewer's behalf.
 */
import { NextResponse } from 'next/server'
import type { Member } from '@/types'
import type { Tenant } from '@/lib/tenant'
import { memberHomeHost } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { hasMemberSignedCurrent } from '@/lib/liabilityAgreement'
import { productNameFor, skipsAgreementWall } from '@/lib/storeDemo'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { assistantNameFromSettings } from '@/lib/assistantNameFromRows'

type TenantLike = Pick<Tenant, 'id' | 'slug'> & { brand?: BrandKey | null; host_aliases?: string[] | null; settings?: unknown }
type MemberLike = Pick<Member, 'id'> & {
  role?: string | null
  home_subdomain?: string | null
  settings?: unknown
  acting_assistant?: { id: string } | null
}
export type AgreementCtx = { tenant: TenantLike; member: MemberLike }

export type AgreementStatus =
  | { ok: true }
  | { ok: false; reason: 'unsigned' | 'check_failed'; signUrl: string; message: string }

type Checker = (memberId: string, brand?: BrandKey | null) => Promise<boolean>

/** The member whose signature counts: the assistant themself when acting for an exec. */
export function signerIdFor(member: MemberLike): string {
  return member.acting_assistant?.id ?? member.id
}

/** Where they sign: their own home page on their company's host (the sign screen is there). */
export function agreementSignUrl(tenant: TenantLike, member: MemberLike): string {
  const host = memberHomeHost(tenant, member.home_subdomain)
  const root = getBrand((tenant.brand ?? 'virtualcloser') as BrandKey).rootDomain
  const path = isEmployeeOnlyMember(member, tenant as Tenant) ? '/dashboard/me' : '/dashboard'
  return `https://${host}.${root}${path}`
}

/** The one human line every channel shows. The Pinnacle edition never says "Suite CXO". */
export function agreementRequiredMessage(tenant: TenantLike, member: MemberLike, signUrl = agreementSignUrl(tenant, member)): string {
  const product = productNameFor(tenant.id)
  const name = assistantNameFromSettings(tenant.settings, member.settings)
  return `Sign the ${product} agreement at ${signUrl} to keep using ${name}.`
}

export function agreementCheckFailedMessage(): string {
  return 'I could not check your signed agreement just now. Try again in a minute.'
}

// Signed is permanent for a version, so a "yes" is cached briefly per
// instance. "No" and errors are never cached: signing takes effect at once.
const SIGNED_TTL_MS = 5 * 60_000
const signedCache = new Map<string, number>()

/** Tests only. */
export function _resetAgreementCache() {
  signedCache.clear()
}

export async function checkAgreement(ctx: AgreementCtx, check: Checker = hasMemberSignedCurrent, now = Date.now()): Promise<AgreementStatus> {
  if (skipsAgreementWall(ctx.tenant.id)) return { ok: true }
  const signer = signerIdFor(ctx.member)
  const brand = (ctx.tenant.brand ?? null) as BrandKey | null
  const key = `${brand ?? 'virtualcloser'}:${signer}`
  const hit = signedCache.get(key)
  if (hit && hit > now) return { ok: true }
  const signUrl = agreementSignUrl(ctx.tenant, ctx.member)
  let signed: boolean
  try {
    signed = await check(signer, brand)
  } catch (err) {
    console.error('[agreementWall] check failed', err)
    return { ok: false, reason: 'check_failed', signUrl, message: agreementCheckFailedMessage() }
  }
  if (signed) {
    signedCache.set(key, now + SIGNED_TTL_MS)
    return { ok: true }
  }
  return { ok: false, reason: 'unsigned', signUrl, message: agreementRequiredMessage(ctx.tenant, ctx.member, signUrl) }
}

/**
 * For web and phone-app API routes: null when the member may go on, else the
 * response to return. `error` is the human line (the phone app shows a
 * response's `error` as-is); `code` is for code.
 *   unsigned     → 403 { error, code: 'agreement_required', signUrl }
 *   check failed → 503 { error, code: 'agreement_check_failed', signUrl }
 */
export async function requireSignedMember(ctx: AgreementCtx, check?: Checker): Promise<NextResponse | null> {
  const s = await checkAgreement(ctx, check)
  if (s.ok) return null
  const unsigned = s.reason === 'unsigned'
  return NextResponse.json(
    { ok: false, error: s.message, code: unsigned ? 'agreement_required' : 'agreement_check_failed', signUrl: s.signUrl },
    { status: unsigned ? 403 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
