'use client'

type Props = {
  signatureName: string
  feeDollars: string
  checkoutUrl: string
}

export default function PayStep({ signatureName, feeDollars, checkoutUrl }: Props) {
  const firstName = signatureName.split(' ')[0] || signatureName
  return (
    <div>
      <div style={cardStyle}>
        <p style={eyebrowStyle}>Virtual Closer — Onboarding</p>
        <h1 style={headingStyle}>Agreement signed — complete your setup</h1>
        <p style={bodyStyle}>
          Thanks, {firstName}. Your Operational &amp; Liability Agreement has been signed and
          recorded. One last step: pay the one-time setup fee so we can build out your workspace.
        </p>
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#0f0f0f' }}>
          One-time setup &amp; build fee
        </h2>
        <p style={{ ...bodyStyle, marginBottom: 20 }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: '#ff2800' }}>${feeDollars}</span>
          <span style={{ fontSize: 14, color: '#6b7280', marginLeft: 6 }}>one-time</span>
        </p>
        <ul
          style={{
            margin: '0 0 24px',
            padding: '0 0 0 18px',
            fontSize: 14,
            color: '#374151',
            lineHeight: 1.7,
          }}
        >
          <li>AI voice agent configuration &amp; testing</li>
          <li>CRM workspace provisioning</li>
          <li>Twilio sub-account setup</li>
          <li>Onboarding call with your account manager</li>
        </ul>

        <a
          href={checkoutUrl}
          style={{
            display: 'inline-block',
            padding: '13px 28px',
            background: '#ff2800',
            color: '#fff',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            textDecoration: 'none',
            letterSpacing: '0.04em',
          }}
        >
          Pay ${feeDollars} — Complete Setup →
        </a>

        <p style={{ marginTop: 14, fontSize: 12, color: '#9ca3af' }}>
          Secure payment via Stripe. Your login credentials are emailed automatically after
          payment confirmation.
        </p>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid rgba(15,15,15,0.12)',
  borderRadius: 14,
  padding: '28px 28px',
  marginBottom: 20,
}

const eyebrowStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#ff2800',
  fontWeight: 700,
}

const headingStyle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 22,
  fontWeight: 700,
  color: '#0f0f0f',
}

const bodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.6,
  color: '#444',
}
