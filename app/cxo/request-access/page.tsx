import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { enforceRateLimit } from '@/lib/rateLimit'
import CxAuthCard from '@/app/components/cxo/CxAuthCard'

export const dynamic = 'force-dynamic'

/**
 * Suite CXO "Request access" (the login card's link). Saves the request as a
 * prospect for the team to follow up; it sends no email and books nothing.
 * Lives under /cxo so it is public on every CXO host, including a tenant's
 * own login host (where /demo is the Virtual Closer demo).
 */
export default async function CxoRequestAccessPage({ searchParams }: { searchParams?: Promise<{ sent?: string; error?: string }> }) {
  const params = (await searchParams) ?? {}

  async function requestAccess(fd: FormData) {
    'use server'
    const str = (k: string, max: number) => String(fd.get(k) ?? '').trim().slice(0, max)
    // Honeypot: real people never fill this field.
    if (str('website', 200)) redirect('/cxo/request-access?sent=1')
    const name = str('name', 120)
    const email = str('email', 200).toLowerCase()
    const company = str('company', 160)
    const role = str('role', 120)
    const notes = str('notes', 2000)
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect('/cxo/request-access?error=missing')
    const h = await headers()
    const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
    const rl = await enforceRateLimit(`cxo_request_access:${ip}`, 5, 3600)
    if (!rl.allowed) redirect('/cxo/request-access?error=busy')
    const { error } = await supabase.from('prospects').insert({
      source: 'cxo_request_access',
      name,
      email,
      company: company || null,
      tier_interest: 'cxo',
      notes: [role ? `Role: ${role}` : '', notes].filter(Boolean).join('\n') || null,
      status: 'new',
      payload: { via: 'cxo_login', role: role || null, host: h.get('host') ?? null },
    })
    if (error) {
      console.error('[cxo request-access] save failed', error.message)
      redirect('/cxo/request-access?error=save')
    }
    redirect('/cxo/request-access?sent=1')
  }

  if (params.sent === '1') {
    return (
      <CxAuthCard title="Request received" sub="Thank you. Our team will reach out to set up your workspace.">
        <Link href="/login" className="cx-login-submit">
          Back to sign in
        </Link>
      </CxAuthCard>
    )
  }

  const err =
    params.error === 'missing'
      ? 'Please add your name and a work email.'
      : params.error === 'busy'
        ? 'Too many requests from this network. Try again in an hour.'
        : params.error === 'save'
          ? 'That did not save. Please try again.'
          : null

  return (
    <CxAuthCard title="Request access" sub="Tell us who you are and we will set up your operations dashboard.">
      {err && (
        <p className="cx-login-error" role="alert">
          {err}
        </p>
      )}
      <form action={requestAccess} className="cx-login-form">
        <label className="cx-login-field">
          <span>Name</span>
          <input name="name" required autoFocus autoComplete="name" className="cx-login-input" />
        </label>
        <label className="cx-login-field">
          <span>Work email</span>
          <input name="email" type="email" required autoComplete="email" className="cx-login-input" />
        </label>
        <label className="cx-login-field">
          <span>Company</span>
          <input name="company" autoComplete="organization" className="cx-login-input" />
        </label>
        <label className="cx-login-field">
          <span>Role</span>
          <input name="role" autoComplete="organization-title" className="cx-login-input" />
        </label>
        <label className="cx-login-field">
          <span>Anything we should know</span>
          <textarea name="notes" rows={3} className="cx-login-input" />
        </label>
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }} />
        <button type="submit" className="cx-login-submit">
          Request access
        </button>
      </form>
      <p className="cx-login-links">
        <Link href="/login">Back to sign in</Link>
        <span aria-hidden="true">·</span>
        <Link href="/cxo/demo">See the demo</Link>
      </p>
    </CxAuthCard>
  )
}
