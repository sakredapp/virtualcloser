import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { getLeadById, getLeadActivity } from '@/lib/supabase'
import type { LeadActivityItem } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const STATUS_COLOR: Record<string, string> = {
  hot: '#ef4444',
  warm: '#f97316',
  cold: '#60a5fa',
  dormant: '#94a3b8',
}

const OUTCOME_COLOR: Record<string, string> = {
  positive: '#22c55e',
  booked: '#22c55e',
  closed_won: '#16a34a',
  neutral: '#94a3b8',
  no_answer: '#94a3b8',
  voicemail: '#94a3b8',
  negative: '#ef4444',
  closed_lost: '#dc2626',
}

function fmt(n: number | null) {
  if (!n) return null
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return `$${n}`
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'n/a'
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function ActivityRow({ item }: { item: LeadActivityItem }) {
  if (item.type === 'call') {
    const outcomeColor = item.outcome ? (OUTCOME_COLOR[item.outcome] ?? '#94a3b8') : '#94a3b8'
    const outcomeLabel = item.outcome ? item.outcome.replace(/_/g, ' ') : null
    return (
      <div
        style={{
          display: 'flex',
          gap: 16,
          padding: '16px 0',
          borderBottom: '1px solid #f0ede8',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#fff3f0',
            border: '2px solid #ff2800',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 15,
          }}
        >
          📞
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 4,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14, color: '#0f0f0f' }}>Call logged</span>
            {outcomeLabel && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: outcomeColor,
                  background: `${outcomeColor}18`,
                  padding: '2px 7px',
                  borderRadius: 999,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {outcomeLabel}
              </span>
            )}
            {item.duration_minutes && (
              <span style={{ fontSize: 12, color: '#5a5a5a' }}>{item.duration_minutes}m</span>
            )}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: '#0f0f0f',
              lineHeight: 1.5,
            }}
          >
            {item.summary}
          </p>
          {item.detail && (
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 13,
                color: '#5a5a5a',
              }}
            >
              Next: {item.detail}
            </p>
          )}
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9a9a9a' }}>
            {formatDateTime(item.timestamp)}
          </p>
        </div>
      </div>
    )
  }

  if (item.type === 'task') {
    const isDone = item.status === 'done'
    return (
      <div
        style={{
          display: 'flex',
          gap: 16,
          padding: '16px 0',
          borderBottom: '1px solid #f0ede8',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: isDone ? '#f0fdf4' : '#fefce8',
            border: `2px solid ${isDone ? '#22c55e' : '#f59e0b'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 15,
          }}
        >
          {isDone ? '✅' : '📋'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#0f0f0f' }}>
              Task {isDone ? 'completed' : 'created'}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: isDone ? '#22c55e' : '#f59e0b',
                background: isDone ? '#f0fdf4' : '#fefce8',
                padding: '2px 7px',
                borderRadius: 999,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {item.status}
            </span>
            {item.priority !== 'normal' && (
              <span style={{ fontSize: 12, color: item.priority === 'high' ? '#ef4444' : '#94a3b8' }}>
                {item.priority}
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 14, color: isDone ? '#5a5a5a' : '#0f0f0f', lineHeight: 1.5 }}>
            {item.summary}
          </p>
          {item.detail && (
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#5a5a5a' }}>
              Due: {formatDate(item.detail)}
            </p>
          )}
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9a9a9a' }}>
            {formatDateTime(item.timestamp)}
          </p>
        </div>
      </div>
    )
  }

  // note
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        padding: '16px 0',
        borderBottom: '1px solid #f0ede8',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: '#f7f4ef',
          border: '2px solid #d4cfca',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 15,
        }}
      >
        📝
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#0f0f0f', marginBottom: 4 }}>Note</div>
        <p style={{ margin: 0, fontSize: 14, color: '#0f0f0f', lineHeight: 1.5 }}>
          {item.summary}
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9a9a9a' }}>
          {formatDate(item.timestamp)}
        </p>
      </div>
    </div>
  )
}

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const isApex =
    host.startsWith('www.') ||
    host === 'virtualcloser.com' ||
    host === 'localhost:3000'
  if (isApex) redirect('/login')

  let tenant
  try {
    ;({ tenant } = await requireMember())
  } catch {
    redirect('/login')
  }

  const [lead, activity] = await Promise.all([
    getLeadById(tenant.id, id),
    getLeadActivity(tenant.id, id),
  ])

  if (!lead) notFound()

  const statusColor = STATUS_COLOR[lead.status] ?? '#94a3b8'
  const dealFmt = fmt(lead.deal_value)

  const callCount = activity.filter((a) => a.type === 'call').length
  const taskCount = activity.filter((a) => a.type === 'task').length
  const noteCount = activity.filter((a) => a.type === 'note').length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--red)' }}>
      {/* top bar */}
      <div
        style={{
          padding: '20px 24px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <Link
          href="/dashboard/pipeline"
          style={{
            color: 'rgba(255,255,255,0.75)',
            fontSize: 13,
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          ← Pipeline
        </Link>
        <Link
          href="/dashboard"
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 13,
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Dashboard
        </Link>
      </div>

      {/* lead header card */}
      <div style={{ padding: '20px 24px 0' }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: '24px 28px',
            marginBottom: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h1
                  style={{
                    margin: 0,
                    fontSize: 24,
                    fontWeight: 800,
                    color: '#0f0f0f',
                    letterSpacing: '-0.4px',
                  }}
                >
                  {lead.name}
                </h1>
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: statusColor,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: statusColor,
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                  }}
                >
                  {lead.status}
                </span>
              </div>
              {lead.company && (
                <p style={{ margin: '0 0 8px', fontSize: 16, color: '#5a5a5a', fontWeight: 500 }}>
                  {lead.company}
                </p>
              )}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px 16px',
                  fontSize: 13,
                  color: '#5a5a5a',
                }}
              >
                {lead.email && <span>✉ {lead.email}</span>}
                {lead.last_contact && <span>Last contact: {timeAgo(lead.last_contact)}</span>}
                {lead.source && <span>Source: {lead.source}</span>}
              </div>
            </div>
            {dealFmt && (
              <div
                style={{
                  background: '#fff8f5',
                  border: '2px solid #ff2800',
                  borderRadius: 12,
                  padding: '10px 18px',
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                <div style={{ fontSize: 11, color: '#5a5a5a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Deal Value
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#ff2800', letterSpacing: '-0.5px' }}>
                  {dealFmt}
                </div>
              </div>
            )}
          </div>

          {/* stats row */}
          <div
            style={{
              display: 'flex',
              gap: 20,
              marginTop: 20,
              paddingTop: 20,
              borderTop: '1px solid #f0ede8',
            }}
          >
            {[
              { label: 'Calls', value: callCount, icon: '📞' },
              { label: 'Tasks', value: taskCount, icon: '📋' },
              { label: 'Notes', value: noteCount, icon: '📝' },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f0f0f' }}>
                  {s.icon} {s.value}
                </div>
                <div style={{ fontSize: 12, color: '#5a5a5a', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* activity stream */}
      <div style={{ padding: '16px 24px 40px' }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: '24px 28px',
          }}
        >
          <h2
            style={{
              margin: '0 0 4px',
              fontSize: 16,
              fontWeight: 700,
              color: '#0f0f0f',
              letterSpacing: '-0.2px',
            }}
          >
            Activity
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: '#5a5a5a' }}>
            Calls, tasks, and notes — newest first
          </p>

          {activity.length === 0 ? (
            <div
              style={{
                padding: '40px 0',
                textAlign: 'center',
                color: '#9a9a9a',
                fontSize: 14,
              }}
            >
              No activity yet. Log a call or schedule a follow-up via Telegram to see it here.
            </div>
          ) : (
            <div>
              {activity.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
