// /dashboard/shifts — agent self-serve shift editor.
//
// Reads/writes dialer_shifts (already exists from earlier dialer-hours
// migration). Each row is one weekday + start_minute + end_minute window;
// the dialer-queue cron checks these via lib/dialerHours.isInActiveShift
// before placing any new outbound call. Mid-call shift-end is allowed —
// the gate only blocks NEW calls after the window closes.

import { requireMember } from '@/lib/tenant'
import { listShifts } from '@/lib/dialerHours'
import { listSalespeople } from '@/lib/ai-salesperson'
import ShiftsClient from './ShiftsClient'

export const dynamic = 'force-dynamic'

export default async function ShiftsPage() {
  const session = await requireMember()
  const { member, tenant } = session
  const [shifts, salespeople] = await Promise.all([
    listShifts(tenant.id, member.id),
    listSalespeople(tenant.id, { memberIds: [member.id] }),
  ])
  const tz = (member as { timezone?: string | null }).timezone ?? 'UTC'
  const agent = salespeople[0] ?? null
  const agentDisplayName = agent?.voice_persona?.ai_name || agent?.name || null

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
      <header style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#ff2800', margin: 0 }}>
          Dialing schedule
        </p>
        <h1 style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 800, color: '#0f172a' }}>
          {agentDisplayName ? `When does ${agentDisplayName} clock in?` : 'Dialing shifts'}
        </h1>

        {agent ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '5px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 999 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: agent.status === 'active' ? '#16a34a' : '#f59e0b', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d' }}>
              {agentDisplayName}
              {agent.voice_persona?.role_title ? ` · ${agent.voice_persona.role_title}` : ''}
            </span>
            <span style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>({agent.status})</span>
          </div>
        ) : (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '5px 12px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: 999 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#854d0e' }}>No AI voice agent assigned</span>
            <span style={{ fontSize: 11, color: '#a16207' }}>— set one up in the Dialer tab first</span>
          </div>
        )}

        <p style={{ margin: '12px 0 0', fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
          Pick the time windows your AI is allowed to dial. All times in your timezone (<strong style={{ color: '#0f172a' }}>{tz}</strong>).
          Add as many windows per day as you like (e.g. 9–11am and 3–7pm). Outside these windows the dialer pauses —
          already-active calls always finish.
        </p>
      </header>
      <ShiftsClient initialShifts={shifts} timezone={tz} />
    </main>
  )
}
