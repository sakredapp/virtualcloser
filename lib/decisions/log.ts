/**
 * Company decision log (Suite CXO, Ciao): the database half.
 *
 *  - recordDecisionsForNote: called by the digest writer (lib/meetingLoop)
 *    right after a meeting's digest is saved. One cxo_decisions row per
 *    decision ((note_id, idx) unique, so a re-read never doubles), then the
 *    conservative reversal check (lib/decisions/shared.findReversal). A
 *    reversal is flagged on both rows and, when it was decided in the last
 *    NOTIFY_WITHIN_DAYS, the owner and admins get one in-app notice.
 *  - runDecisionLogTick: Hetzner worker catch-up. Records any digest that has
 *    decisions but no rows yet (the backfill of meetings read before this
 *    shipped, and a safety net if the hook ever fails). Deterministic, no model.
 *  - listDecisions: the log as one member may see it. Each row inherits the
 *    visibility of its meeting (lib/knowledge/searchShared.canSeeHit).
 *
 * In-app only: no email, text or push. Kill switch CXO_DECISION_LOG=off.
 */
import { supabase } from '@/lib/supabase'
import { insertNotices, type NoticeRow } from '@/lib/followups/engine'
import { canSeeHit, type SearchScope } from '@/lib/knowledge/searchShared'
import {
  LOOKBACK_DAYS,
  decisionsFromDigest,
  findReversal,
  matchScore,
  reversalNoticeKey,
  reversalNoticeText,
  shouldNotify,
  topicKey,
  type LoggedDecision,
} from './shared'

export const DECISION_ALERT_ROLES = ['owner', 'admin'] as const
export const DECISIONS_HREF = '/dashboard/meetings#decisions'

type Err = { code?: string; message?: string } | null
const missing = (err: Err) => !!err && ['42P01', 'PGRST205'].includes(String(err.code))

export function decisionLogOn(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CXO_DECISION_LOG ?? '').trim().toLowerCase() !== 'off'
}

export type DecisionRow = LoggedDecision & {
  rep_id: string
  idx: number
  decided_by: string | null
  topic: string
  reverses_id: string | null
  reversed_by_id: string | null
  reversal_reason: string | null
}

const COLS = 'id, rep_id, note_id, idx, text, decided_by, decided_at, meeting_title, topic, reverses_id, reversed_by_id, reversal_reason'

type NoteRef = { id: string; title: string | null; occurred_at: string | null }

export type RecordResult = { inserted: number; reversals: number; notices: number }

/** Log one meeting's decisions and flag reversals. Quiet no-op before the table exists. */
export async function recordDecisionsForNote(
  repId: string,
  note: NoteRef,
  digest: { decisions?: unknown; decided?: unknown } | null | undefined,
  now = new Date(),
): Promise<RecordResult> {
  const out: RecordResult = { inserted: 0, reversals: 0, notices: 0 }
  if (!decisionLogOn()) return out
  const list = decisionsFromDigest(digest)
  if (!list.length) return out
  const decidedAt = note.occurred_at && Number.isFinite(Date.parse(note.occurred_at)) ? new Date(note.occurred_at).toISOString() : now.toISOString()
  const rows = list.map((d) => ({
    rep_id: repId,
    note_id: note.id,
    idx: d.idx,
    text: d.text,
    decided_by: d.by,
    decided_at: decidedAt,
    meeting_title: note.title ? note.title.slice(0, 300) : null,
    topic: topicKey(d.text),
  }))
  const { data, error } = await supabase.from('cxo_decisions').upsert(rows, { onConflict: 'note_id,idx', ignoreDuplicates: true }).select(COLS)
  if (missing(error)) return out
  if (error) throw new Error(`cxo_decisions: ${error.message}`)
  const fresh = (data ?? []) as DecisionRow[]
  out.inserted = fresh.length
  if (!fresh.length) return out

  const since = new Date(Date.parse(decidedAt) - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data: prior, error: pErr } = await supabase
    .from('cxo_decisions')
    .select(COLS)
    .eq('rep_id', repId)
    .neq('note_id', note.id)
    .gte('decided_at', since)
    .lt('decided_at', decidedAt)
    .order('decided_at', { ascending: false })
    .limit(500)
  if (pErr) throw new Error(`cxo_decisions: ${pErr.message}`)
  const earlier = (prior ?? []) as DecisionRow[]
  if (!earlier.length) return out

  const notices: NoticeRow[] = []
  let execs: string[] | null = null
  for (const d of fresh) {
    const hit = findReversal(d, earlier)
    if (!hit) continue
    const reason = hit.reason.slice(0, 300)
    const [a, b] = await Promise.all([
      supabase.from('cxo_decisions').update({ reverses_id: hit.target.id, reversal_reason: reason }).eq('id', d.id).eq('rep_id', repId),
      supabase.from('cxo_decisions').update({ reversed_by_id: d.id }).eq('id', hit.target.id).eq('rep_id', repId).is('reversed_by_id', null),
    ])
    if (a.error) throw new Error(`cxo_decisions: ${a.error.message}`)
    if (b.error) console.error('[decisions] mark reversed', hit.target.id, b.error.message)
    out.reversals++
    if (!shouldNotify(d.decided_at, now)) continue // backfill of an old meeting: flagged, not announced
    execs ??= await execMemberIds(repId)
    const text = reversalNoticeText(d, hit.target, reason)
    for (const memberId of execs) {
      notices.push({
        rep_id: repId,
        member_id: memberId,
        key: reversalNoticeKey(d.id, memberId),
        kind: 'report',
        item_kind: 'meeting',
        item_id: d.note_id,
        title: text.title,
        body: text.body,
        href: DECISIONS_HREF,
        due_date: null,
      })
    }
  }
  if (notices.length) out.notices = (await insertNotices(notices)).length
  return out
}

async function execMemberIds(repId: string): Promise<string[]> {
  const { data, error } = await supabase.from('members').select('id').eq('rep_id', repId).eq('is_active', true).in('role', [...DECISION_ALERT_ROLES]).limit(200)
  if (error) throw new Error(`members: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map((m) => m.id)
}

export type DecisionTickResult = { tenants: number; notes: number; inserted: number; reversals: number; notices: number; errors: number }

/** Catch-up across every Suite CXO tenant, oldest meeting first. Never throws. */
export async function runDecisionLogTick(now = new Date(), maxNotes = 40): Promise<DecisionTickResult> {
  const out: DecisionTickResult = { tenants: 0, notes: 0, inserted: 0, reversals: 0, notices: 0, errors: 0 }
  if (!decisionLogOn()) return out
  const { data, error } = await supabase.from('reps').select('id').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) {
    console.error('[decisions] tenants', error.message)
    out.errors++
    return out
  }
  for (const t of (data ?? []) as Array<{ id: string }>) {
    try {
      const { data: notes, error: nErr } = await supabase
        .from('plaud_notes')
        .select('id, title, occurred_at, mira_digest')
        .eq('rep_id', t.id)
        .not('mira_digest', 'is', null)
        .order('occurred_at', { ascending: true })
        .limit(1000)
      if (nErr) throw new Error(nErr.message)
      const withDecisions = ((notes ?? []) as Array<NoteRef & { mira_digest: unknown }>).filter((n) => decisionsFromDigest(n.mira_digest as never).length > 0)
      if (!withDecisions.length) continue
      out.tenants++
      const { data: logged, error: lErr } = await supabase.from('cxo_decisions').select('note_id').eq('rep_id', t.id).in('note_id', withDecisions.map((n) => n.id))
      if (missing(lErr)) return out // cxo_decisions.sql not applied yet: quiet
      if (lErr) throw new Error(lErr.message)
      const done = new Set(((logged ?? []) as Array<{ note_id: string }>).map((r) => r.note_id))
      for (const n of withDecisions.filter((x) => !done.has(x.id)).slice(0, maxNotes)) {
        const r = await recordDecisionsForNote(t.id, n, n.mira_digest as never, now)
        out.notes++
        out.inserted += r.inserted
        out.reversals += r.reversals
        out.notices += r.notices
      }
    } catch (err) {
      out.errors++
      console.error('[decisions] tenant', t.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}

export type VisibleDecision = {
  id: string
  note_id: string
  text: string
  decided_by: string | null
  decided_at: string
  meeting: string | null
  /** This decision undid an earlier one. */
  reverses: { id: string; text: string; decided_at: string; meeting: string | null } | null
  /** A later decision undid this one. */
  reversed_by: { id: string; text: string; decided_at: string; meeting: string | null } | null
  reversal_reason: string | null
}

type NoteFacts = { id: string; rep_id: string; owner_member_id: string | null; attendees: unknown; triage_class: string | null }

/**
 * The decision log as this member may see it, newest first. With `query`,
 * only decisions about those words, best match first. A reversal partner from
 * a meeting the member cannot see is never shown.
 */
export async function listDecisions(scope: SearchScope, opts: { query?: string; limit?: number; sinceIso?: string } = {}): Promise<VisibleDecision[]> {
  const limit = Math.max(1, Math.min(50, Math.floor(opts.limit ?? 10)))
  let q = supabase.from('cxo_decisions').select(COLS).eq('rep_id', scope.repId)
  if (opts.sinceIso) q = q.gte('decided_at', opts.sinceIso)
  const { data, error } = await q.order('decided_at', { ascending: false }).limit(500)
  if (missing(error)) return []
  if (error) throw new Error(`cxo_decisions: ${error.message}`)
  const rows = (data ?? []) as DecisionRow[]
  if (!rows.length) return []
  const noteIds = [...new Set(rows.map((r) => r.note_id))]
  const { data: nd, error: nErr } = await supabase.from('plaud_notes').select('id, rep_id, owner_member_id, attendees, triage_class').eq('rep_id', scope.repId).in('id', noteIds)
  if (nErr) throw new Error(`plaud_notes: ${nErr.message}`)
  const visibleNotes = new Set(
    ((nd ?? []) as NoteFacts[])
      .filter((n) => canSeeHit({ source: 'meeting', id: n.id, rep_id: n.rep_id, title: '', body: '', when: null, owner_member_id: n.owner_member_id, attendees: n.attendees, triage_class: n.triage_class }, scope))
      .map((n) => n.id),
  )
  const seen = rows.filter((r) => r.rep_id === scope.repId && visibleNotes.has(r.note_id))
  const byId = new Map(seen.map((r) => [r.id, r]))
  const ref = (id: string | null) => {
    const r = id ? byId.get(id) : undefined
    return r ? { id: r.id, text: r.text, decided_at: r.decided_at, meeting: r.meeting_title } : null
  }
  let picked = seen
  const query = (opts.query ?? '').trim()
  if (query) {
    picked = seen
      .map((r) => ({ r, s: matchScore(r.text, r.meeting_title, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.r.decided_at.localeCompare(a.r.decided_at))
      .map((x) => x.r)
  }
  return picked.slice(0, limit).map((r) => {
    const reverses = ref(r.reverses_id)
    return {
      id: r.id,
      note_id: r.note_id,
      text: r.text,
      decided_by: r.decided_by,
      decided_at: r.decided_at,
      meeting: r.meeting_title,
      reverses,
      reversed_by: ref(r.reversed_by_id),
      reversal_reason: reverses ? r.reversal_reason : null,
    }
  })
}
