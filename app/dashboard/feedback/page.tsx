import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import { visibilityScope } from '@/lib/permissions'
import { getManagedTeamIds } from '@/lib/members'
import { supabase } from '@/lib/supabase'
import {
  createMemo,
  getMemo,
  getMemoSignedUrl,
  listForManager,
  listForRep,
  relayFeedbackToSender,
  setMemoStatus,
  type VoiceMemo,
  type VoiceMemoStatus,
} from '@/lib/voice-memos'
import { telegramBotUsername } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

type LeadLite = { id: string; name: string; company: string | null }
type MemberLite = { id: string; display_name: string; role: string }

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function statusLabel(s: VoiceMemoStatus): string {
  switch (s) {
    case 'pending': return 'Pending review'
    case 'in_review': return 'In review'
    case 'ready': return 'Ready to send'
    case 'needs_work': return 'Needs work'
    case 'archived': return 'Archived'
  }
}

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; tab?: string }>
}) {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  const { tenant, member } = await requireMember()
  const scope = visibilityScope(member.role)
  const isManagerView = scope !== 'self'
  const navTabs = await buildDashboardTabs(tenant.id, member)

  const sp = (await searchParams) ?? {}
  const search = sp.q?.trim() ?? ''
  const tab = sp.tab === 'archive' ? 'archive' : 'queue'

  // Resolve managed team ids: admins/owners (account scope) get null = "all".
  let managedTeamIds: string[] | null = null
  if (scope === 'team') {
    managedTeamIds = await getManagedTeamIds(member.id)
  }

  const memos = isManagerView
    ? await listForManager(tenant.id, member.id, managedTeamIds, search || null)
    : await listForRep(tenant.id, member.id, search || null)

  // Resolve referenced members + leads in a single round-trip each.
  const memberIds = new Set<string>()
  const leadIds = new Set<string>()
  for (const m of memos) {
    memberIds.add(m.sender_member_id)
    if (m.recipient_member_id) memberIds.add(m.recipient_member_id)
    if (m.reviewed_by_member_id) memberIds.add(m.reviewed_by_member_id)
    if (m.lead_id) leadIds.add(m.lead_id)
  }
  const memberById = new Map<string, MemberLite>()
  if (memberIds.size > 0) {
    const { data: mr } = await supabase
      .from('members')
      .select('id, display_name, role')
      .in('id', Array.from(memberIds))
    for (const x of (mr ?? []) as MemberLite[]) memberById.set(x.id, x)
  }
  const leadById = new Map<string, LeadLite>()
  if (leadIds.size > 0) {
    const { data: lr } = await supabase
      .from('leads')
      .select('id, name, company')
      .eq('rep_id', tenant.id)
      .in('id', Array.from(leadIds))
    for (const x of (lr ?? []) as LeadLite[]) leadById.set(x.id, x)
  }

  // Pre-generate signed URLs for storage paths so the player can stream.
  const signedByMemo = new Map<string, string>()
  for (const m of memos) {
    if (m.storage_path) {
      const url = await getMemoSignedUrl(m.storage_path, 60 * 60)
      if (url) signedByMemo.set(m.id, url)
    }
  }

  // Group children (feedback memos) under their parent pitch.
  const childrenByParent = new Map<string, VoiceMemo[]>()
  for (const m of memos) {
    if (m.kind === 'feedback' && m.parent_memo_id) {
      const arr = childrenByParent.get(m.parent_memo_id) ?? []
      arr.push(m)
      childrenByParent.set(m.parent_memo_id, arr)
    }
  }

  const pitchMemos = memos.filter((m) => m.kind === 'pitch' || m.kind === 'coaching')
  const queueMemos = pitchMemos.filter((m) => m.status === 'pending' || m.status === 'in_review')
  const archiveMemos = pitchMemos.filter((m) => m.status === 'ready' || m.status === 'needs_work' || m.status === 'archived')
  const visibleMemos = tab === 'archive' ? archiveMemos : queueMemos

  // ── Server actions ──────────────────────────────────────────────────────

  async function actSetStatus(formData: FormData) {
    'use server'
    const { tenant: t2, member: me2 } = await requireMember()
    const memoId = String(formData.get('memoId') ?? '')
    const status = String(formData.get('status') ?? '') as VoiceMemoStatus
    if (!memoId || !['ready', 'needs_work', 'archived', 'in_review'].includes(status)) return
    const target = await getMemo(memoId)
    if (!target || target.rep_id !== t2.id) return
    await setMemoStatus(memoId, status, me2.id)
    // Notify rep when a final state is reached.
    if (status === 'ready' || status === 'needs_work') {
      const fb = await createMemo({
        repId: t2.id,
        senderMemberId: me2.id,
        recipientMemberId: target.sender_member_id,
        teamId: target.team_id,
        leadId: target.lead_id,
        parentMemoId: target.id,
        kind: 'feedback',
        transcript: status === 'ready' ? 'Marked ready to send.' : 'Needs more work.',
      })
      await relayFeedbackToSender(target, fb, me2.display_name)
    }
    revalidatePath('/dashboard/feedback')
  }

  async function actSendText(formData: FormData) {
    'use server'
    const { tenant: t2, member: me2 } = await requireMember()
    const memoId = String(formData.get('memoId') ?? '')
    const note = String(formData.get('note') ?? '').trim()
    if (!memoId || !note) return
    const target = await getMemo(memoId)
    if (!target || target.rep_id !== t2.id || (target.kind !== 'pitch' && target.kind !== 'coaching')) return
    const fb = await createMemo({
      repId: t2.id,
      senderMemberId: me2.id,
      recipientMemberId: target.sender_member_id,
      teamId: target.team_id,
      leadId: target.lead_id,
      parentMemoId: target.id,
      kind: 'feedback',
      transcript: note,
    })
    if (target.status === 'pending') {
      await setMemoStatus(memoId, 'in_review', me2.id)
    }
    await relayFeedbackToSender(target, fb, me2.display_name)
    revalidatePath('/dashboard/feedback')
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <main className="wrap">
      <header className="hero" style={{ marginBottom: '0.5rem' }}>
        <div>
          <p className="eyebrow">
            {isManagerView ? 'Coaching · feedback loop' : 'Your reviews · feedback loop'}
          </p>
          <h1 style={{ marginBottom: '0.2rem' }}>Feedback</h1>
          <p className="sub" style={{ marginTop: 0 }}>
            {isManagerView
              ? 'Call recordings and coaching questions from your team. Listen, react, ship feedback in real time.'
              : 'Send call recordings to your manager for review. Their feedback lands here and pings you on Telegram the moment it&rsquo;s ready.'}
          </p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <section className="card">
        <div className="section-head">
          <h2 style={{ margin: 0 }}>{isManagerView ? 'Coaching queue' : 'Your reviews'}</h2>
          <p>
            {tab === 'queue' ? `${queueMemos.length} active` : `${archiveMemos.length} archived`}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link
            href="/dashboard/feedback?tab=queue"
            className="btn"
            style={tab === 'queue' ? { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' } : undefined}
          >
            Queue ({queueMemos.length})
          </Link>
          <Link
            href="/dashboard/feedback?tab=archive"
            className="btn"
            style={tab === 'archive' ? { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' } : undefined}
          >
            Archive ({archiveMemos.length})
          </Link>
          <form action="/dashboard/feedback" method="get" style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <input type="hidden" name="tab" value={tab} />
            <input
              type="text"
              name="q"
              defaultValue={search}
              placeholder="Search transcripts…"
              style={{ minWidth: 220, padding: '6px 10px', border: '1px solid var(--border-soft)', borderRadius: 8, background: 'var(--paper)', color: 'var(--ink)' }}
            />
            <button className="btn" type="submit">Search</button>
          </form>
        </div>
      </section>

      {/* ── How to use ───────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>From Telegram</h3>
        <ul style={{ marginTop: 8, paddingLeft: 18, color: 'var(--muted)' }}>
          <li><strong>Send a call for review</strong> &mdash; share an audio file from a real sales call (Zoom export, dialer download, voice memo app), name the manager who should hear it. Bot relays it 1:1 to that manager.</li>
          <li><strong>Coaching question</strong> &mdash; reps just ask, e.g. <em>&ldquo;how do I respond when they say it&rsquo;s too expensive?&rdquo;</em> The bot routes the question to managers automatically.</li>
          <li>Manager replies (voice or text &mdash; <code>ready</code> / <code>needs work</code>) and feedback bounces back to the rep instantly.</li>
        </ul>
      </div>

      {/* ── Memos ────────────────────────────────────────────────────── */}
      {visibleMemos.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            {tab === 'archive'
              ? 'Nothing in the archive yet.'
              : isManagerView
                ? 'Inbox zero. No call recordings or coaching questions waiting on you.'
                : 'Nothing in review. Drop a call recording into Telegram and name a manager, or just ask a coaching question.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          {visibleMemos.map((m) => {
            const sender = memberById.get(m.sender_member_id)
            const lead = m.lead_id ? leadById.get(m.lead_id) : null
            const audioUrl = signedByMemo.get(m.id)
            const children = (childrenByParent.get(m.id) ?? []).sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            )
            return (
              <div className="card" key={m.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>
                      {sender?.display_name ?? 'Unknown rep'}
                      {m.kind === 'coaching' ? (
                        <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                          coaching question
                        </span>
                      ) : (
                        <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                          call recording
                        </span>
                      )}
                      {lead ? (
                        <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>
                          · {lead.name}{lead.company ? ` · ${lead.company}` : ''}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                      {timeAgo(m.created_at)}
                      {m.duration_seconds ? ` · ${m.duration_seconds}s` : ''}
                      {' · '}
                      <span className={`status ${m.status === 'ready' ? 'hot' : m.status === 'needs_work' ? 'cold' : 'warm'}`}>
                        {statusLabel(m.status)}
                      </span>
                    </div>
                  </div>
                </div>

                {audioUrl ? (
                  <audio controls preload="none" src={audioUrl} style={{ width: '100%', marginTop: 10 }}>
                    Your browser doesn&apos;t support audio playback.
                  </audio>
                ) : m.kind === 'coaching' ? null : (
                  <p style={{ marginTop: 10, color: 'var(--muted)', fontSize: 13 }}>
                    Audio still uploading or stored on Telegram only.
                  </p>
                )}

                {m.kind === 'coaching' && m.transcript ? (
                  <blockquote
                    style={{
                      margin: '12px 0 0',
                      padding: '10px 14px',
                      borderLeft: '3px solid var(--accent, #ff2800)',
                      background: 'var(--paper-2, #f7f4ef)',
                      fontSize: 15,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    “{m.transcript}”
                  </blockquote>
                ) : null}

                {m.transcript && m.kind !== 'coaching' ? (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Transcript</summary>
                    <p style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{m.transcript}</p>
                  </details>
                ) : null}

                {isManagerView && (m.kind === 'pitch' || m.kind === 'coaching') && m.status !== 'archived' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <form action={actSetStatus}>
                        <input type="hidden" name="memoId" value={m.id} />
                        <input type="hidden" name="status" value="ready" />
                        <button className="btn approve" type="submit">{m.kind === 'coaching' ? '✅ Mark answered' : '✅ Ready to send'}</button>
                      </form>
                      <form action={actSetStatus}>
                        <input type="hidden" name="memoId" value={m.id} />
                        <input type="hidden" name="status" value="needs_work" />
                        <button className="btn dismiss" type="submit">{m.kind === 'coaching' ? '💬 Needs follow-up' : '🛠 Needs work'}</button>
                      </form>
                      <form action={actSetStatus}>
                        <input type="hidden" name="memoId" value={m.id} />
                        <input type="hidden" name="status" value="archived" />
                        <button className="btn" type="submit">Archive</button>
                      </form>
                    </div>
                    <form action={actSendText} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input type="hidden" name="memoId" value={m.id} />
                      <textarea
                        name="note"
                        rows={m.kind === 'coaching' ? 4 : 2}
                        placeholder={m.kind === 'coaching'
                          ? 'Type your coaching answer (sends to the rep on Telegram)…'
                          : 'Type quick feedback (sends to the rep on Telegram)…'}
                        style={{ padding: 8, border: '1px solid var(--paper-2)', borderRadius: 6, fontFamily: 'inherit' }}
                      />
                      <button className="btn" type="submit" style={{ alignSelf: 'flex-start' }}>{m.kind === 'coaching' ? 'Send coaching answer' : 'Send written feedback'}</button>
                    </form>
                  </div>
                ) : null}

                {children.length > 0 ? (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--paper-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>Feedback</div>
                    {children.map((c) => {
                      const reviewer = memberById.get(c.sender_member_id)
                      const childUrl = signedByMemo.get(c.id)
                      return (
                        <div key={c.id} style={{ paddingLeft: 12, borderLeft: '3px solid var(--accent, #ff2800)' }}>
                          <div style={{ fontWeight: 600 }}>
                            📨 {reviewer?.display_name ?? 'Manager'}
                            <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                              {timeAgo(c.created_at)}
                            </span>
                          </div>
                          {childUrl ? (
                            <audio controls preload="none" src={childUrl} style={{ width: '100%', marginTop: 6 }} />
                          ) : null}
                          {c.transcript ? (
                            <p style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{c.transcript}</p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
