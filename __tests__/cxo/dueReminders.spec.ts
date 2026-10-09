import { describe, expect, it } from 'vitest'
import { planReminders, reminderKindFor, reminderKey, dueWords, reminderPrefs, inDigest, cardHref, type PlanCard, type PlanAssignee, type PlanMember } from '@/lib/dueRemindersShared'
import { renderDueDigest } from '@/lib/dueDigestEmail'

const REP = 'rep_test'
const member: PlanMember = { id: 'm1', rep_id: REP, timezone: 'America/New_York', is_active: true }
const card = (due: string | null, extra: Partial<PlanCard> = {}): PlanCard => ({ id: 'c1', rep_id: REP, due_date: due, done_at: null, ...extra })
const on = (cardId = 'c1', memberId: string | null = 'm1', partnerId: string | null = null): PlanAssignee => ({ card_id: cardId, member_id: memberId, partner_id: partnerId })
// 15:00 UTC = 11:00 New York (EDT): the cron's local morning.
const at = (day: string) => new Date(`${day}T15:00:00Z`)

/** Runs the daily job once per day over a span, carrying what was sent. */
function simulate(due: string, days: string[], cards: PlanCard[] = [card(due)], assignees: PlanAssignee[] = [on()], members: PlanMember[] = [member]) {
  const sent = new Set<string>()
  const fired: Array<{ day: string; kind: string }> = []
  for (const day of days) {
    for (const r of planReminders({ cards, assignees, members, sent, now: at(day) })) {
      sent.add(reminderKey(r.card_id, r.member_id, r.kind))
      fired.push({ day, kind: r.kind })
    }
  }
  return fired
}
function span(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(from + 'T12:00:00Z'); t <= Date.parse(to + 'T12:00:00Z'); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

describe('reminderKindFor', () => {
  it('maps days left to the step', () => {
    expect(reminderKindFor(30)).toBeNull()
    expect(reminderKindFor(8)).toBeNull()
    expect(reminderKindFor(7)).toBe('d7')
    expect(reminderKindFor(5)).toBe('d7')
    expect(reminderKindFor(3)).toBe('d3')
    expect(reminderKindFor(2)).toBe('d3')
    expect(reminderKindFor(1)).toBe('d1')
    expect(reminderKindFor(0)).toBe('d0')
    expect(reminderKindFor(-1)).toBe('overdue')
  })
})

describe('planReminders: which days fire', () => {
  it('fires 7, 3, 1 days before, on the day, and once overdue', () => {
    const fired = simulate('2026-10-20', span('2026-10-01', '2026-11-05'))
    expect(fired).toEqual([
      { day: '2026-10-13', kind: 'd7' },
      { day: '2026-10-17', kind: 'd3' },
      { day: '2026-10-19', kind: 'd1' },
      { day: '2026-10-20', kind: 'd0' },
      { day: '2026-10-21', kind: 'overdue' },
    ])
  })

  it('never repeats when the job runs twice a day', () => {
    const days = span('2026-10-10', '2026-10-25').flatMap((d) => [d, d])
    const fired = simulate('2026-10-20', days)
    expect(fired.map((f) => f.kind)).toEqual(['d7', 'd3', 'd1', 'd0', 'overdue'])
  })

  it('a card made 5 days out gets the nearest step only, then the rest', () => {
    const fired = simulate('2026-10-20', span('2026-10-15', '2026-10-22'))
    expect(fired).toEqual([
      { day: '2026-10-15', kind: 'd7' },
      { day: '2026-10-17', kind: 'd3' },
      { day: '2026-10-19', kind: 'd1' },
      { day: '2026-10-20', kind: 'd0' },
      { day: '2026-10-21', kind: 'overdue' },
    ])
  })

  it('uses the member time zone for "today"', () => {
    // 02:00 UTC Oct 20 is still Oct 19 in New York, already Oct 20 in UTC.
    const now = new Date('2026-10-20T02:00:00Z')
    const ny = planReminders({ cards: [card('2026-10-20')], assignees: [on()], members: [member], sent: new Set(), now })
    const utc = planReminders({ cards: [card('2026-10-20')], assignees: [on()], members: [{ ...member, timezone: 'UTC' }], sent: new Set(), now })
    expect(ny[0].kind).toBe('d1')
    expect(utc[0].kind).toBe('d0')
  })

  it('skips partners, done cards, no due date, inactive members, other orgs, and old overdue cards', () => {
    const now = at('2026-10-20')
    const base = { members: [member, { ...member, id: 'm2', is_active: false }, { ...member, id: 'm3', rep_id: 'other' }], sent: new Set<string>(), now }
    expect(planReminders({ ...base, cards: [card('2026-10-20')], assignees: [on('c1', null, 'p1')] })).toEqual([])
    expect(planReminders({ ...base, cards: [card('2026-10-20', { done_at: '2026-10-19T00:00:00Z' })], assignees: [on()] })).toEqual([])
    expect(planReminders({ ...base, cards: [card(null)], assignees: [on()] })).toEqual([])
    expect(planReminders({ ...base, cards: [card('2026-10-20')], assignees: [on('c1', 'm2')] })).toEqual([])
    expect(planReminders({ ...base, cards: [card('2026-10-20')], assignees: [on('c1', 'm3')] })).toEqual([])
    expect(planReminders({ ...base, cards: [card('2026-09-01')], assignees: [on()] })).toEqual([])
  })

  it('one reminder per member per card even if listed twice; each member gets their own', () => {
    const m2 = { ...member, id: 'm2' }
    const out = planReminders({ cards: [card('2026-10-21')], assignees: [on(), on(), on('c1', 'm2')], members: [member, m2], sent: new Set(), now: at('2026-10-20') })
    expect(out.map((r) => `${r.member_id}:${r.kind}`).sort()).toEqual(['m1:d1', 'm2:d1'])
  })
})

describe('words, prefs, links', () => {
  it('says it plainly', () => {
    expect(dueWords(0)).toBe('Due today')
    expect(dueWords(1)).toBe('Due tomorrow')
    expect(dueWords(4)).toBe('Due in 4 days')
    expect(dueWords(-1)).toBe('Overdue by 1 day')
    expect(dueWords(-3)).toBe('Overdue by 3 days')
  })
  it('in-app on and email off by default', () => {
    expect(reminderPrefs(null)).toEqual({ inApp: true, email: false })
    expect(reminderPrefs({ due_reminders_in_app: false, due_reminders_email: true })).toEqual({ inApp: false, email: true })
  })
  it('digest window and card link', () => {
    expect(inDigest(8)).toBe(false)
    expect(inDigest(7)).toBe(true)
    expect(inDigest(-14)).toBe(true)
    expect(inDigest(-15)).toBe(false)
    expect(cardHref('b 1', 'c1')).toBe('/dashboard/boards?board=b%201&card=c1')
  })
  it('digest email lists each card with date and link, escapes titles', () => {
    const mail = renderDueDigest({
      firstName: 'Lauren',
      items: [
        { title: 'Q4 <plan>', board: 'Ops', due_date: '2026-10-21', days_left: 1, url: 'https://pinnacle.suitecxo.com/dashboard/boards?board=b&card=c' },
        { title: 'Carrier review', board: 'Sales', due_date: '2026-10-18', days_left: -2, url: 'https://pinnacle.suitecxo.com/x' },
      ],
      boardsUrl: 'https://pinnacle.suitecxo.com/dashboard/boards',
      settingsUrl: 'https://pinnacle.suitecxo.com/dashboard/settings',
    })
    expect(mail.html).toContain('Q4 &lt;plan&gt;')
    expect(mail.html).not.toContain('Q4 <plan>')
    expect(mail.html).toContain('card=c')
    expect(mail.text).toContain('Carrier review')
    expect(mail.html.indexOf('Carrier review')).toBeLessThan(mail.html.indexOf('Q4 &lt;plan&gt;'))
  })
})
