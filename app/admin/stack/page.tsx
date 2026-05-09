import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type ServiceStatus = 'connected' | 'missing' | 'optional'

type Service = {
  name: string
  category: string
  purpose: string
  envVars: string[]        // checked for connected/missing status
  extraVars?: string[]     // shown in UI but not used for status
  dashboardUrl: string
  required: boolean
}

const SERVICES: Service[] = [
  // AI
  {
    name: 'Anthropic',
    category: 'AI',
    purpose: 'Core AI — agent loop, system prompts, Telegram brain',
    envVars: ['ANTHROPIC_API_KEY'],
    dashboardUrl: 'https://console.anthropic.com',
    required: true,
  },
  {
    name: 'Tavily',
    category: 'AI',
    purpose: 'Web search for AI agent ("find me a sushi spot in Dallas")',
    envVars: ['TAVILY_API_KEY'],
    dashboardUrl: 'https://app.tavily.com',
    required: false,
  },
  {
    name: 'OpenAI',
    category: 'AI',
    purpose: 'Whisper transcription for call recordings',
    envVars: ['OPENAI_API_KEY'],
    dashboardUrl: 'https://platform.openai.com',
    required: false,
  },
  {
    name: 'VAPI',
    category: 'AI',
    purpose: 'AI voice calling infrastructure (legacy — RevRing is primary)',
    envVars: ['VAPI_TOOL_SECRET'],
    dashboardUrl: 'https://dashboard.vapi.ai',
    required: false,
  },
  {
    name: 'RevRing',
    category: 'AI',
    purpose: 'AI voice dialer — outbound SDR, receptionist, appointment setter',
    envVars: ['REVRING_API_KEY'],
    extraVars: ['REVRING_MASTER_API_KEY', 'REVRING_WEBHOOK_SECRET'],
    dashboardUrl: 'https://revring.ai/dashboard',
    required: true,
  },
  // Infrastructure
  {
    name: 'Supabase',
    category: 'Infrastructure',
    purpose: 'Database, auth, storage — everything persistent',
    envVars: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    dashboardUrl: 'https://supabase.com/dashboard',
    required: true,
  },
  {
    name: 'Vercel',
    category: 'Infrastructure',
    purpose: 'Hosting, deployments, cron jobs',
    envVars: ['VERCEL_API_TOKEN', 'CRON_SECRET'],
    dashboardUrl: 'https://vercel.com/dashboard',
    required: true,
  },
  // Payments
  {
    name: 'Stripe',
    category: 'Payments',
    purpose: 'Billing — build fees, subscriptions, usage charges',
    envVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
    dashboardUrl: 'https://dashboard.stripe.com',
    required: true,
  },
  // Messaging
  {
    name: 'Telegram',
    category: 'Messaging',
    purpose: 'Telegram bot — AI assistant for reps, morning briefings',
    envVars: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'],
    dashboardUrl: 'https://t.me/BotFather',
    required: true,
  },
  {
    name: 'Resend',
    category: 'Messaging',
    purpose: 'Transactional email — welcome, booking notifications',
    envVars: ['RESEND_API_KEY'],
    dashboardUrl: 'https://resend.com/dashboard',
    required: true,
  },
  {
    name: 'Twilio',
    category: 'Messaging',
    purpose: 'SMS, call logs, recordings',
    envVars: ['TWILIO_MASTER_ACCOUNT_SID', 'TWILIO_MASTER_AUTH_TOKEN'],
    dashboardUrl: 'https://console.twilio.com',
    required: false,
  },
  // CRM / Sales Tools
  {
    name: 'GoHighLevel (GHL)',
    category: 'CRM',
    purpose: 'CRM sync — contacts, appointments, pipeline',
    envVars: ['GHL_WEBHOOK_SECRET'],
    dashboardUrl: 'https://app.gohighlevel.com',
    required: false,
  },
  {
    name: 'Wavv',
    category: 'CRM',
    purpose: 'Power dialer for outbound calling',
    envVars: ['WAVV_WEBHOOK_SECRET'],
    dashboardUrl: 'https://wavv.com',
    required: false,
  },
  {
    name: 'Furnace',
    category: 'CRM',
    purpose: 'Ad lead pipeline — sends qualified leads to VirtualCloser',
    envVars: ['FURNACE_INBOUND_SECRET', 'FURNACE_SYNC_URL', 'LEADS_WEBHOOK_SECRET'],
    dashboardUrl: 'https://furnace.app',
    required: false,
  },
  // Calendar / Scheduling
  {
    name: 'Google OAuth',
    category: 'Calendar',
    purpose: 'Calendar events, Google Sheets access',
    envVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    dashboardUrl: 'https://console.cloud.google.com',
    required: false,
  },
  {
    name: 'Cal.com',
    category: 'Calendar',
    purpose: 'Booking pages, webhook on new bookings',
    envVars: ['CAL_WEBHOOK_SECRET'],
    dashboardUrl: 'https://app.cal.com',
    required: false,
  },
  // Analytics
  {
    name: 'Fathom Analytics',
    category: 'Analytics',
    purpose: 'Privacy-first web analytics + prospect webhooks',
    envVars: ['FATHOM_API_KEY', 'FATHOM_PROSPECT_WEBHOOK_TOKEN', 'FATHOM_WEBHOOK_SECRET'],
    dashboardUrl: 'https://app.usefathom.com',
    required: false,
  },
]

const CATEGORY_ORDER = ['AI', 'Infrastructure', 'Payments', 'Messaging', 'CRM', 'Calendar', 'Analytics']

function getStatus(service: Service): ServiceStatus {
  const allSet = service.envVars.every((v) => !!process.env[v])
  const anySet = service.envVars.some((v) => !!process.env[v])
  if (allSet) return 'connected'
  if (!service.required && !anySet) return 'optional'
  return 'missing'
}

function statusDot(status: ServiceStatus) {
  if (status === 'connected') return { color: '#22c55e', label: 'Connected' }
  if (status === 'missing') return { color: '#ef4444', label: 'Missing' }
  return { color: '#6b7280', label: 'Not configured' }
}

export default async function StackPage() {
  const authed = await isAdminAuthed()
  if (!authed) redirect('/admin/login')

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    services: SERVICES.filter((s) => s.category === cat).map((s) => ({
      ...s,
      status: getStatus(s),
    })),
  })).filter((g) => g.services.length > 0)

  const connected = SERVICES.filter((s) => getStatus(s) === 'connected').length
  const missing = SERVICES.filter((s) => getStatus(s) === 'missing').length

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', padding: '2rem 2.4rem' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
            Tech Stack
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.45)', margin: '4px 0 0', fontSize: 13 }}>
            All services powering VirtualCloser. Check env vars, top up credits, verify connectivity.
          </p>
          <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
            <Pill color="#22c55e" label={`${connected} connected`} />
            {missing > 0 && <Pill color="#ef4444" label={`${missing} missing`} />}
          </div>
        </div>

        {/* Sections */}
        {byCategory.map(({ cat, services }) => (
          <div key={cat} style={{ marginBottom: '2rem' }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.3)', marginBottom: 10,
            }}>
              {cat}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {services.map((s) => {
                const dot = statusDot(s.status)
                return (
                  <div key={s.name} style={{
                    background: '#141414',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 8,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 14,
                  }}>
                    {/* Status dot */}
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: dot.color, flexShrink: 0, marginTop: 5,
                      boxShadow: s.status === 'connected' ? `0 0 6px ${dot.color}` : 'none',
                    }} />

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</span>
                        <span style={{
                          fontSize: 11, color: dot.color, fontWeight: 600,
                          background: `${dot.color}18`, borderRadius: 4, padding: '1px 7px',
                        }}>
                          {dot.label}
                        </span>
                        {!s.required && (
                          <span style={{
                            fontSize: 11, color: 'rgba(255,255,255,0.25)',
                            background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '1px 7px',
                          }}>
                            optional
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
                        {s.purpose}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        {[...s.envVars, ...(s.extraVars ?? [])].map((v) => (
                          <code key={v} style={{
                            fontSize: 10, background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 4, padding: '2px 6px',
                            color: process.env[v] ? '#86efac' : '#f87171',
                            fontFamily: 'monospace',
                          }}>
                            {v}
                          </code>
                        ))}
                      </div>
                    </div>

                    {/* Dashboard link */}
                    <a
                      href={s.dashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 12, color: 'rgba(255,255,255,0.35)',
                        textDecoration: 'none', flexShrink: 0, marginTop: 1,
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 5, padding: '4px 10px',
                        transition: 'color 120ms',
                      }}
                    >
                      Dashboard →
                    </a>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: '1rem' }}>
          Status is checked server-side from Vercel env vars at page load. Set missing vars in the{' '}
          <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer"
            style={{ color: 'rgba(255,255,255,0.35)' }}>
            Vercel dashboard
          </a>.
        </div>
      </div>
    </div>
  )
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, color,
      background: `${color}18`, borderRadius: 20, padding: '3px 12px',
      border: `1px solid ${color}30`,
    }}>
      {label}
    </span>
  )
}
