import type { DailyPlan, PlanItem } from '@/lib/plaud/dailyPlan'

const PRIORITY_COLOR: Record<PlanItem['priority'], string> = {
  high: 'var(--red, #dc2626)',
  normal: 'var(--royal, #2563eb)',
  low: 'var(--muted, #9ca3af)',
}

const CATEGORY_LABEL: Record<PlanItem['category'], string> = {
  follow_up: 'follow-up',
  task: 'task',
  message: 'message',
  reminder: 'reminder',
  decision: 'decision',
  other: '',
}

/**
 * "Today's plan" — the overseer's morning briefing on the Command Center.
 *
 * Rolls up the day's recordings + open tasks into one prioritized list with a
 * reason per item. Spencer rates the plan and each item 👍/👎 (+ optional why);
 * that feedback feeds the next morning's planner. Server component — feedback
 * goes through the inline server-action forms passed in from the page.
 */
export default function MorningPlanCard({
  plan,
  feedback,
  feedbackAction,
}: {
  plan: DailyPlan
  feedback: Record<string, 'up' | 'down'>
  feedbackAction: (formData: FormData) => Promise<void>
}) {
  const planVerdict = feedback['plan'] ?? null

  return (
    <section
      data-widget="morning-plan"
      style={{
        margin: '1rem 0 0',
        background: 'var(--paper)',
        border: '1px solid var(--border-soft)',
        borderLeft: '3px solid var(--red, #dc2626)',
        borderRadius: 12,
        padding: '1rem 1.1rem',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.8rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--muted)' }}>
            Today&apos;s plan · from your recordings
          </p>
          {plan.intro && (
            <p style={{ margin: '0.35rem 0 0', fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{plan.intro}</p>
          )}
        </div>
        <a href="/dashboard/plaud" style={{ fontSize: 12, color: 'var(--accent, var(--red))', textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>
          Recordings →
        </a>
      </div>

      <ol style={{ listStyle: 'none', padding: 0, margin: '0.9rem 0 0', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {plan.items.map((item, i) => {
          const verdict = feedback[String(i)] ?? null
          const cat = CATEGORY_LABEL[item.category]
          return (
            <li
              key={i}
              style={{
                border: '1px solid var(--border-soft)',
                borderRadius: 10,
                padding: '0.7rem 0.85rem',
                background: 'var(--panel, #fff)',
              }}
            >
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: PRIORITY_COLOR[item.priority],
                    flexShrink: 0,
                    marginTop: '0.45em',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14, lineHeight: 1.4 }}>
                    {item.title}
                    {cat && (
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>
                        {cat}
                      </span>
                    )}
                  </p>
                  {item.detail && (
                    <p style={{ margin: '0.2rem 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }}>{item.detail}</p>
                  )}
                  {item.reasoning && (
                    <p style={{ margin: '0.3rem 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--muted)', fontStyle: 'italic' }}>
                      Why: {item.reasoning}
                    </p>
                  )}

                  <ItemFeedback
                    planId={plan.id}
                    itemIndex={i}
                    itemTitle={item.title}
                    verdict={verdict}
                    action={feedbackAction}
                  />
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {/* Plan-level verdict — the signal the planner weights most heavily. */}
      <div style={{ marginTop: '0.9rem', paddingTop: '0.8rem', borderTop: '1px solid var(--border-soft)' }}>
        <p style={{ margin: '0 0 0.45rem', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
          Was this plan useful? Your answer trains tomorrow&apos;s.
        </p>
        <form action={feedbackAction} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="hidden" name="planId" value={plan.id} />
          <input type="hidden" name="itemIndex" value="" />
          <input type="hidden" name="itemTitle" value="" />
          <input
            name="reason"
            placeholder="What was good or off? (optional)"
            style={{
              flex: 1,
              minWidth: 180,
              padding: '0.4rem 0.6rem',
              border: '1px solid var(--panel-border, var(--border-soft))',
              borderRadius: 8,
              fontSize: 13,
              background: 'var(--panel, #fff)',
              color: 'var(--ink, var(--text))',
            }}
          />
          <FeedbackButtons verdict={planVerdict} />
        </form>
      </div>
    </section>
  )
}

function ItemFeedback({
  planId,
  itemIndex,
  itemTitle,
  verdict,
  action,
}: {
  planId: string
  itemIndex: number
  itemTitle: string
  verdict: 'up' | 'down' | null
  action: (formData: FormData) => Promise<void>
}) {
  return (
    <form action={action} style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="itemIndex" value={itemIndex} />
      <input type="hidden" name="itemTitle" value={itemTitle} />
      <input
        name="reason"
        placeholder={verdict === 'down' ? 'Why did this miss? (optional)' : 'Note (optional)'}
        style={{
          flex: 1,
          minWidth: 140,
          padding: '0.3rem 0.5rem',
          border: '1px solid var(--panel-border, var(--border-soft))',
          borderRadius: 7,
          fontSize: 12,
          background: 'var(--panel, #fff)',
          color: 'var(--ink, var(--text))',
        }}
      />
      <FeedbackButtons verdict={verdict} small />
    </form>
  )
}

function FeedbackButtons({ verdict, small }: { verdict: 'up' | 'down' | null; small?: boolean }) {
  const pad = small ? '0.25rem 0.5rem' : '0.35rem 0.7rem'
  const fontSize = small ? 13 : 14
  const base = {
    padding: pad,
    fontSize,
    border: '1px solid var(--border-soft)',
    borderRadius: 7,
    cursor: 'pointer',
    background: 'var(--panel, #fff)',
    lineHeight: 1,
  } as const
  return (
    <span style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
      <button
        type="submit"
        name="verdict"
        value="up"
        title="Helpful"
        style={{ ...base, borderColor: verdict === 'up' ? 'var(--signal-ok, #16a34a)' : base.border, background: verdict === 'up' ? 'rgba(22,163,74,0.12)' : base.background }}
      >
        👍
      </button>
      <button
        type="submit"
        name="verdict"
        value="down"
        title="Not helpful"
        style={{ ...base, borderColor: verdict === 'down' ? 'var(--red, #dc2626)' : base.border, background: verdict === 'down' ? 'rgba(220,38,38,0.10)' : base.background }}
      >
        👎
      </button>
      {verdict && (
        <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {verdict === 'up' ? 'marked helpful' : 'noted'}
        </span>
      )}
    </span>
  )
}
