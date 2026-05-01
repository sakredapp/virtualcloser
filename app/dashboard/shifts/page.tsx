// /dashboard/shifts — agent self-serve shift editor.
//
// Reads/writes dialer_shifts (already exists from earlier dialer-hours
// migration). Each row is one weekday + start_minute + end_minute window;
// the dialer-queue cron checks these via lib/dialerHours.isInActiveShift
// before placing any new outbound call. Mid-call shift-end is allowed —
// the gate only blocks NEW calls after the window closes.

import { requireMember } from '@/lib/tenant'
import { listShifts } from '@/lib/dialerHours'
import ShiftsClient from './ShiftsClient'

export const dynamic = 'force-dynamic'

export default async function ShiftsPage() {
  const session = await requireMember()
  const { member, tenant } = session
  const shifts = await listShifts(tenant.id, member.id)
  const tz = (member as { timezone?: string | null }).timezone ?? 'UTC'

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
      <header style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#ff2800', margin: 0 }}>
          Dialing shifts
        </p>
        <h1 style={{ margin: '4px 0 0', fontSize: 28, color: '#0f172a' }}>When does your AI SDR clock in?</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: '#64748b' }}>
          Pick the time ranges your AI SDR is allowed to dial. All times in your timezone (
          <strong>{tz}</strong>). Add as many windows per day as you like (e.g. 9–11am
          and 3–7pm). Outside these windows the dialer pauses — already-active
          calls always get to finish.
        </p>
      </header>
      <ShiftsClient initialShifts={shifts} timezone={tz} />
    </main>
  )
}
