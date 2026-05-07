import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  AGREEMENT_TITLE,
  CURRENT_VERSION,
  renderAgreementBodyFragment,
} from '@/lib/liabilityAgreementCopy'
import SignStep from './SignStep'
import PayStep from './PayStep'

export const dynamic = 'force-dynamic'

export default async function OnboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ paid?: string }>
}) {
  const { token } = await params
  const { paid } = await searchParams

  const { data: row } = await supabase
    .from('onboarding_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (!row) notFound()

  const expired = new Date(row.expires_at as string) < new Date()
  const signed = Boolean(row.signed_at)
  const hasBuildFee = Number(row.build_fee_cents) > 0
  const paid_done = Boolean(row.paid_at) || paid === '1'
  const welcome_sent = Boolean(row.welcome_sent_at)

  // Fetch rep display name for personalisation
  const { data: rep } = await supabase
    .from('reps')
    .select('display_name, email')
    .eq('id', row.rep_id as string)
    .maybeSingle()
  const clientName = (rep?.display_name as string | null) ?? 'there'

  const bodyFragment = renderAgreementBodyFragment()

  // ── Done state ───────────────────────────────────────────────────────────
  if (welcome_sent || (signed && (!hasBuildFee || paid_done))) {
    return (
      <Shell>
        <DoneCard name={clientName} email={(rep?.email as string | null) ?? null} />
      </Shell>
    )
  }

  // ── Expired ──────────────────────────────────────────────────────────────
  if (expired) {
    return (
      <Shell>
        <div style={cardStyle}>
          <h1 style={headingStyle}>Link expired</h1>
          <p style={bodyTextStyle}>
            This onboarding link has expired. Ask your Virtual Closer account manager to generate a
            new one.
          </p>
        </div>
      </Shell>
    )
  }

  // ── Pay step — signed but awaiting payment ────────────────────────────────
  if (signed && hasBuildFee && !paid_done) {
    const feeDollars = (Number(row.build_fee_cents) / 100).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
    return (
      <Shell>
        <PayStep
          signatureName={(row.signature_name as string | null) ?? ''}
          feeDollars={feeDollars}
          checkoutUrl={(row.checkout_url as string | null) ?? '#'}
        />
      </Shell>
    )
  }

  // ── Sign step — full-viewport, no Shell wrapper ──────────────────────────
  return (
    <SignStep
      token={token}
      agreementTitle={AGREEMENT_TITLE}
      agreementVersion={CURRENT_VERSION}
      bodyFragment={bodyFragment}
      clientName={clientName}
      hasBuildFee={hasBuildFee}
      feeCents={Number(row.build_fee_cents)}
    />
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        background: '#f7f4ef',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '24px 16px 40px',
        minHeight: 'calc(100vh - 60px)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 820 }}>{children}</div>
    </main>
  )
}

function DoneCard({ name, email }: { name: string; email: string | null }) {
  const firstName = name.split(' ')[0] || name
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
      <h1 style={{ ...headingStyle, color: '#16a34a' }}>You&apos;re all set, {firstName}!</h1>
      <p style={bodyTextStyle}>
        Check your email{email ? ` at ${email}` : ''} for your login credentials and Telegram link.
        It usually arrives within a minute.
      </p>
      <p style={{ ...bodyTextStyle, marginTop: 12 }}>
        Questions? Reply to the welcome email and we&apos;ll get back to you shortly.
      </p>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid rgba(15,15,15,0.12)',
  borderRadius: 14,
  padding: '32px 28px',
  marginBottom: 24,
}

const headingStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 22,
  fontWeight: 700,
  color: '#0f0f0f',
}

const bodyTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.6,
  color: '#444',
}
