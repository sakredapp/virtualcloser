import { supabase } from '@/lib/supabase'
import { assistantsOf, recentActivity } from '@/lib/assistants'
import { actionAddExecAssistant, actionRemoveExecAssistant } from './assistantActions'
import CopyLink from './CopyLink'

/**
 * Settings › Your assistant (executives only). Add someone by name + email;
 * they get their own login that works your calendar, boards, to-dos,
 * messages and meetings, and never sees pay, financials or usage.
 */
export default async function ExecAssistantSection({
  repId,
  execId,
  rootDomain,
  timezone,
  flash,
}: {
  repId: string
  execId: string
  rootDomain: string
  timezone: string
  flash: { error?: string | null; added?: string | null; sent?: boolean; removed?: string | null }
}) {
  const [mine, activity] = await Promise.all([
    assistantsOf(repId, execId).catch(() => []),
    recentActivity(repId, { execId }, 15).catch(() => []),
  ])
  // A pending set-password link the exec can copy and send themselves.
  const pending = new Map<string, string>()
  if (mine.length) {
    const { data } = await supabase
      .from('members')
      .select('id, password_reset_token, password_reset_expires_at, last_login_at')
      .in('id', mine.map((a) => a.member_id))
    for (const r of (data ?? []) as Array<{ id: string; password_reset_token: string | null; password_reset_expires_at: string | null; last_login_at: string | null }>) {
      if (!r.last_login_at && r.password_reset_token && r.password_reset_expires_at && Date.parse(r.password_reset_expires_at) > Date.now()) {
        pending.set(r.id, `https://${rootDomain}/reset-password?token=${r.password_reset_token}`)
      }
    }
  }
  const names = new Map(mine.map((a) => [a.member_id, a.display_name.split(' ')[0]]))
  const when = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

  return (
    <section className="card cx-ea" id="assistant" style={{ marginTop: '0.8rem' }}>
      <div className="section-head">
        <h2>Your assistant</h2>
        <p>works your calendar, boards, to-dos, messages and meetings</p>
      </div>
      <p className="meta" style={{ margin: '0 0 0.7rem' }}>
        They get their own login. Everything they do shows as done by them for you. They never see pay, payroll, QuickBooks, Sales Plan profit, usage or anyone else&rsquo;s private items.
      </p>

      {flash.error && <p className="cx-ea-flash is-error" role="alert">{flash.error}</p>}
      {flash.added && !flash.error && (
        <p className="cx-ea-flash" role="status">
          Added <strong>{flash.added}</strong>. {flash.sent ? 'We emailed them a link to set their password.' : 'Copy their set-password link below and send it to them.'}
        </p>
      )}
      {flash.removed && !flash.error && <p className="cx-ea-flash" role="status">Removed <strong>{flash.removed}</strong>. Their login is off.</p>}

      <form action={actionAddExecAssistant} className="cx-ea-form">
        <input type="text" name="display_name" required placeholder="Their name" autoComplete="off" aria-label="Assistant name" />
        <input type="email" name="email" required placeholder="assistant@company.com" autoComplete="off" aria-label="Assistant email" />
        <label className="cx-ea-check">
          <input type="checkbox" name="send_email" defaultChecked />
          <span>Email them the link</span>
        </label>
        <button type="submit" className="cx-btn">Add assistant</button>
      </form>

      {mine.length === 0 ? (
        <p className="meta" style={{ margin: 0 }}>No assistant yet.</p>
      ) : (
        <ul className="cx-ea-list">
          {mine.map((a) => (
            <li key={a.member_id}>
              <div className="cx-ea-who">
                <strong>{a.display_name}</strong>
                <span className="meta">{a.email} · {a.last_login_at ? `last in ${when(a.last_login_at)}` : 'has not signed in yet'}</span>
                {pending.get(a.member_id) && <CopyLink url={pending.get(a.member_id)!} />}
              </div>
              <form action={actionRemoveExecAssistant}>
                <input type="hidden" name="assistant_id" value={a.member_id} />
                <button type="submit" className="cx-btn-ghost cx-btn cx-btn-sm">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {activity.length > 0 && (
        <>
          <p className="cx-eyebrow" style={{ margin: '1rem 0 0.4rem' }}>What your assistant did</p>
          <ul className="cx-ea-feed">
            {activity.map((r) => (
              <li key={r.id}>
                <span className="t">{when(r.created_at)}</span>
                <span className="n">{r.summary}</span>
                <span className="by">by {names.get(r.assistant_member_id) ?? 'your assistant'} for you</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
