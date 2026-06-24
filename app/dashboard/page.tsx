import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  getBrainBuckets,
  getLeadsByPriority,
  getPendingEmailDrafts,
  setAgentActionStatus,
  setBrainItemStatus,
  supabase,
} from '@/lib/supabase'
import type { BrainItem, BrainItemStatus } from '@/types'
import { getCurrentTenant, getCurrentMember, isGatewayHost, requireMember, requireTenant } from '@/lib/tenant'
import { isAtLeast, visibilityScope, resolveMemberDataScope } from '@/lib/permissions'
import { getTeamGoalsForMember } from '@/lib/leaderboard'
import { telegramBotUsername } from '@/lib/telegram'
import { sendEmail } from '@/lib/email'
import { getTokensFor, googleOauthConfigured } from '@/lib/google'
import { listKpiCards, archiveCard as archiveKpiCard, logEntry as logKpiEntry, normalizeMetric } from '@/lib/kpi-cards'
import DashboardAutoRefresh from './AutoRefresh'
import TimezoneSync from './TimezoneSync'
import DashboardCustomizer from './DashboardCustomizer'
import DashboardNav from './DashboardNav'
import { buildDashboardTabs } from './dashboardTabs'
import { getMyOpenTasks } from '@/lib/projects'
import NewKpiModal from './NewKpiModal'
import BotInstructionsModal from './BotInstructionsModal'
import FirstRunGuide from './FirstRunGuide'
import { getBrand, type BrandKey } from '@/lib/brand'
import { buildExecDigest, type ExecDigest } from '@/lib/exec/digest'
import CommandCenterToday from './CommandCenterToday'
import ReportIssueCard from './ReportIssueCard'
import RecommendationsCard, { type RecommendationLite } from './RecommendationsCard'
import { recommendationsFromDigest, syncRecommendations } from '@/lib/recommendations/engine'
import { loadAgingFollowups } from '@/lib/recommendations/callFollowups'
import { fetchMonthSummary } from '@/lib/pinnacle/rollup'
import MorningPlanCard from './MorningPlanCard'
import { loadTodaysPlan, loadPlanFeedback } from '@/lib/plaud/dailyPlan'

export const dynamic = 'force-dynamic'

const statusTone: Record<string, string> = {
  hot: 'status hot',
  warm: 'status warm',
  cold: 'status cold',
  dormant: 'status dormant',
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'n/a'
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

type HorizonKey = 'week' | 'month' | 'quarter' | 'year'
function findGoal(items: BrainItem[], horizon: HorizonKey): BrainItem | null {
  for (const it of items) if (it.horizon === horizon) return it
  return null
}

export default async function DashboardPage() {
  // If someone hits /dashboard on the apex/www/preview host, there is no
  // tenant in context — send them to the marketing/login flow instead of
  // throwing a 500.
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) {
    redirect('/login')
  }

  const tenant = await getCurrentTenant()
  if (!tenant) {
    redirect('/login')
  }

  // Brand for this tenant — drives which Telegram bot the dashboard links
  // to (@SuiteCxObot for CXO, @VirtualCloserBot for VC) and the support email.
  const brandKey = ((tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const botUsername = telegramBotUsername(brandKey)

  const viewerMember = await getCurrentMember()

  // Command Center rollup — CXO execs get a "what needs you today" strip at the
  // top of the dashboard, powered by the same digest as the daily brief.
  // Best-effort: failure degrades to no strip rather than breaking the page.
  let execDigest: ExecDigest | null = null
  if (brandKey === 'cxo') {
    execDigest = await buildExecDigest(tenant, {
      memberId: viewerMember?.id ?? null,
      timezone: viewerMember?.timezone || tenant.timezone || undefined,
    }).catch(() => null)
  }


  // Pinnacle revenue strip on the Command Center — gated to the same rep ids
  // as the Pinnacle tab (Spencer). Other cxo users still get the agenda.
  const pinnacleAllowed = (process.env.PINNACLE_VIEWER_REP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(tenant.id)
  const showPinnacleStrip = brandKey === 'cxo' && pinnacleAllowed

  const canSeeTeam = viewerMember ? visibilityScope(viewerMember.role) !== 'self' : false
  const canSeeManagerRoom = viewerMember ? isAtLeast(viewerMember.role, 'manager') : false
  const canSeeOwnersRoom = viewerMember ? isAtLeast(viewerMember.role, 'admin') : false
  // Resolve the read-scope for this viewer so the queries below only fetch
  // rows the viewer is allowed to see (rep \u2192 self, manager \u2192 their teams,
  // admin/owner \u2192 the whole account). Without this, the dashboard query
  // returned the entire account every time and relied on cosmetic UI
  // filtering \u2014 fine for one-seat accounts, unsafe for enterprise.
  const viewerScope = viewerMember ? await resolveMemberDataScope(viewerMember) : null

  // Morning plan — the Plaud overseer's daily briefing. Only renders when a plan
  // was generated for today (gated upstream by PLAUD_AGENT_REP_IDS), so tenants
  // without the agent never see the card. Best-effort: failure → no card.
  const morningPlan = await loadTodaysPlan(
    tenant.id,
    viewerMember?.timezone || tenant.timezone || 'America/New_York',
  ).catch(() => null)
  const morningPlanFeedback = morningPlan
    ? await loadPlanFeedback(morningPlan.id).catch(() => ({} as Record<string, 'up' | 'down'>))
    : {}

  async function onPlanFeedback(formData: FormData) {
    'use server'
    const planId = String(formData.get('planId') ?? '')
    const verdict = String(formData.get('verdict') ?? '')
    if (!planId || (verdict !== 'up' && verdict !== 'down')) return

    const itemIndexRaw = String(formData.get('itemIndex') ?? '').trim()
    const itemIndex = itemIndexRaw === '' ? null : Number(itemIndexRaw)
    if (itemIndex !== null && !Number.isInteger(itemIndex)) return
    const itemTitle = String(formData.get('itemTitle') ?? '').trim().slice(0, 300) || null
    const reason = String(formData.get('reason') ?? '').trim().slice(0, 1000) || null

    const { tenant: t, member: m } = await requireMember()

    // Guard: the plan must belong to this tenant before we attach feedback.
    const { data: planRow } = await supabase
      .from('plaud_daily_plans')
      .select('id')
      .eq('id', planId)
      .eq('rep_id', t.id)
      .maybeSingle()
    if (!planRow) return

    await supabase.from('plaud_plan_feedback').insert({
      plan_id: planId,
      rep_id: t.id,
      member_id: m.id,
      item_index: itemIndex,
      item_title: itemTitle,
      verdict,
      reason,
    })

    // Any feedback marks the plan reviewed (drives status off pending_review).
    await supabase
      .from('plaud_daily_plans')
      .update({ status: 'reviewed', reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', planId)
      .eq('rep_id', t.id)

    // Unify the two memories: a plan reaction (esp. a 👎, or any reaction with a
    // reason) becomes a durable planner guidance rule — same store the Plaud
    // note-agent and planner already read — instead of only a recency-weighted
    // feedback row. Best-effort; never block the response.
    if (itemTitle && (verdict === 'down' || reason)) {
      try {
        const { learnFromFeedback } = await import('@/lib/plaud/guidance')
        await learnFromFeedback({
          repId: t.id,
          claudeKey: (t as { claude_api_key?: string | null }).claude_api_key ?? null,
          source: 'plan',
          scope: 'planner',
          signal: verdict === 'down' ? 'avoid' : 'prefer',
          context: `Daily plan item: "${itemTitle}"`,
          reason: reason ?? '',
          memberId: m.id,
          createdBy: m.display_name ?? null,
        })
      } catch (err) {
        console.warn('[plan-feedback] learn failed', err instanceof Error ? err.message : String(err))
      }
    }

    revalidatePath('/dashboard')
  }

  async function onDraftAction(formData: FormData) {
    'use server'

    const actionId = String(formData.get('actionId') ?? '')
    const status = String(formData.get('status') ?? '') as 'sent' | 'dismissed'

    if (!actionId || (status !== 'sent' && status !== 'dismissed')) {
      return
    }

    const t = await requireTenant()

    // If approving, try to actually send the email via Resend.
    if (status === 'sent') {
      const { data: row } = await supabase
        .from('agent_actions')
        .select('id, content, lead_id')
        .eq('id', actionId)
        .eq('rep_id', t.id)
        .maybeSingle()

      if (row) {
        let subject = 'Follow-up'
        let body = typeof row.content === 'string' ? row.content : ''
        try {
          const parsed = JSON.parse(row.content ?? '{}')
          if (parsed && typeof parsed.subject === 'string') subject = parsed.subject
          if (parsed && typeof parsed.body === 'string') body = parsed.body
        } catch {}

        let toEmail: string | null = null
        if (row.lead_id) {
          const { data: lead } = await supabase
            .from('leads')
            .select('email')
            .eq('id', row.lead_id)
            .eq('rep_id', t.id)
            .maybeSingle()
          toEmail = lead?.email ?? null
        }

        if (toEmail) {
          const html = body
            .split('\n')
            .map((l) => `<p style="margin:0 0 12px;line-height:1.55;">${l.replace(/</g, '&lt;')}</p>`)
            .join('')
          const replyTo = t.email ?? undefined
          await sendEmail({ to: toEmail, subject, html, text: body, replyTo })
        }
      }
    }

    await setAgentActionStatus(actionId, status, t.id)
    revalidatePath('/dashboard')
  }

  async function onRegenerateLinkCode() {
    'use server'
    const { member } = await requireMember()
    const { generateLinkCode } = await import('@/lib/random')
    const code = generateLinkCode()
    // Each member has their own code + chat. Regenerating is per-member,
    // and unbinds *only* their Telegram chat — not anyone else's.
    await supabase
      .from('members')
      .update({ telegram_link_code: code, telegram_chat_id: null })
      .eq('id', member.id)
    revalidatePath('/dashboard')
  }

  async function onBrainItemAction(formData: FormData) {
    'use server'
    const itemId = String(formData.get('itemId') ?? '')
    const status = String(formData.get('status') ?? '') as BrainItemStatus
    if (!itemId || !['done', 'dismissed', 'open'].includes(status)) return
    const t = await requireTenant()
    await setBrainItemStatus(itemId, status, t.id)
    revalidatePath('/dashboard')
  }

  async function onKpiCardArchive(formData: FormData) {
    'use server'
    const cardId = String(formData.get('cardId') ?? '')
    if (!cardId) return
    const t = await requireTenant()
    await archiveKpiCard(t.id, cardId)
    revalidatePath('/dashboard')
    revalidatePath('/dashboard/analytics')
  }

  async function onKpiCardPin(formData: FormData) {
    'use server'
    const cardId = String(formData.get('cardId') ?? '')
    const pinned = String(formData.get('pinned') ?? '') === '1'
    if (!cardId) return
    const t = await requireTenant()
    const { setCardPinned } = await import('@/lib/kpi-cards')
    await setCardPinned(t.id, cardId, pinned)
    revalidatePath('/dashboard')
    revalidatePath('/dashboard/analytics')
  }

  async function onKpiEntryLog(formData: FormData) {
    'use server'
    const cardId = String(formData.get('cardId') ?? '')
    const rawValue = String(formData.get('value') ?? '').trim()
    if (!cardId || !rawValue) return
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return
    const { tenant: t, member: m } = await requireMember()
    const todayLocal = new Date().toISOString().slice(0, 10)
    await logKpiEntry({
      repId: t.id,
      memberId: m.id,
      cardId,
      day: todayLocal,
      value,
      mode: 'set',
    })
    revalidatePath('/dashboard')
  }

  async function onKpiCardCreate(formData: FormData) {
    'use server'
    const label = String(formData.get('label') ?? '').trim()
    if (!label) return

    // Goal
    const goalRaw = String(formData.get('goal') ?? '').trim()
    const goalNum = goalRaw ? Number(goalRaw) : null
    const goal =
      goalNum && Number.isFinite(goalNum) && goalNum > 0 && goalNum <= 1_000_000
        ? goalNum
        : null

    // Period
    const periodRaw = String(formData.get('period') ?? 'day')
    const period = (['day', 'week', 'month'] as const).includes(periodRaw as never)
      ? (periodRaw as 'day' | 'week' | 'month')
      : 'day'

    // Unit
    const unitRaw = String(formData.get('unit') ?? '').trim()
    const unit = unitRaw && unitRaw !== 'count' ? unitRaw : null

    // Optional description
    const description = String(formData.get('description') ?? '').trim().slice(0, 240) || null

    // Optional starting progress
    const startingRaw = String(formData.get('starting_value') ?? '').trim()
    const startingNum = startingRaw ? Number(startingRaw) : null
    const startingValue =
      startingNum !== null && Number.isFinite(startingNum) && startingNum >= 0 && startingNum <= 1_000_000
        ? startingNum
        : null

    // Optional target date (YYYY-MM-DD)
    const targetRaw = String(formData.get('target_date') ?? '').trim()
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(targetRaw) ? targetRaw : null

    // Reminder config
    const cadenceRaw = String(formData.get('reminder_cadence') ?? 'none')
    const reminderCadence = (['none', 'daily', 'weekdays', 'weekly'] as const).includes(
      cadenceRaw as never,
    )
      ? (cadenceRaw as 'none' | 'daily' | 'weekdays' | 'weekly')
      : 'none'
    const reminderTimeRaw = String(formData.get('reminder_time') ?? '').trim()
    const reminderTime =
      reminderCadence !== 'none' && /^\d{2}:\d{2}$/.test(reminderTimeRaw) ? reminderTimeRaw : null
    const dowRaw = String(formData.get('reminder_dow') ?? '').trim()
    const dowNum = dowRaw ? Number(dowRaw) : null
    const reminderDow =
      reminderCadence === 'weekly' && dowNum !== null && Number.isInteger(dowNum) && dowNum >= 0 && dowNum <= 6
        ? dowNum
        : null

    const { tenant: t, member: m } = await requireMember()
    const norm = normalizeMetric({ label })
    const { createCard, findCard, logEntry } = await import('@/lib/kpi-cards')
    const existing = await findCard(t.id, m.id, norm.key, period)
    if (existing) {
      // Don't overwrite an existing card silently — bail and let the rep edit
      // it from /dashboard/analytics where the editor lives.
      revalidatePath('/dashboard')
      return
    }
    const card = await createCard({
      repId: t.id,
      memberId: m.id,
      metricKey: norm.key,
      label: norm.label,
      unit,
      period,
      goalValue: goal,
      description,
      startingValue,
      targetDate,
      reminderCadence,
      reminderTime,
      reminderDow,
    })

    // Seed today's entry with the starting value so the trail line isn't
    // empty the second they pin a metric mid-cycle.
    if (card && startingValue && startingValue > 0) {
      const todayLocal = new Date().toISOString().slice(0, 10)
      await logEntry({
        repId: t.id,
        memberId: m.id,
        cardId: card.id,
        day: todayLocal,
        value: startingValue,
        mode: 'set',
      })
    }
    revalidatePath('/dashboard')
  }

  const [leads, pendingDrafts, brain, googleTokens] = await Promise.all([
    getLeadsByPriority(tenant.id, viewerScope),
    getPendingEmailDrafts(tenant.id),
    getBrainBuckets(tenant.id, viewerScope),
    // Per-member tokens with tenant-level fallback. Each member sees their
    // own Google connection state (enterprise); individual tier still works
    // off the legacy tenant-level row.
    getTokensFor(tenant.id, viewerMember?.id ?? null),
  ])
  const teamGoals = viewerMember
    ? await getTeamGoalsForMember(tenant.id, viewerMember.id)
    : []

  // Proactive overseer recommendations — derived from the digest + revenue pace
  // (Pinnacle viewers) + team goals, reconciled against stored recs (dedupe,
  // respect dismissals). Best-effort; degrades to no card.
  let recommendations: RecommendationLite[] = []
  if (brandKey === 'cxo' && execDigest) {
    const ms = pinnacleAllowed ? await fetchMonthSummary().catch(() => null) : null
    const pinnacle = ms
      ? { thisMonth: ms.this_month_premium, prevMonth: ms.prev_month_premium, total: ms.this_month_total, paid: ms.this_month_paid }
      : null
    // Plaud actions the assistant prepared and is waiting on approval for — the
    // core exec-assistant signal. Cheap count, head-only.
    const { count: pendingApprovals } = await supabase
      .from('plaud_actions')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', tenant.id)
      .eq('status', 'pending')

    // Exec-world signals from data already loaded: overdue commitments (brain
    // "overdue" bucket) + today's next meeting (exec digest calendar).
    const overdueItems = brain.overdue ?? []
    const overdue = { count: overdueItems.length, topTitle: overdueItems[0]?.content ?? null }

    const recTz = viewerMember?.timezone || tenant.timezone || 'America/New_York'
    const events = execDigest.todayEvents ?? []
    const nowMs = Date.now()
    const nextEvent = events.find((e) => e.start.length === 10 || Date.parse(e.start) >= nowMs) ?? null
    const calendar = {
      count: events.length,
      nextSummary: nextEvent?.summary ?? null,
      nextTime:
        nextEvent && nextEvent.start.length > 10
          ? new Date(nextEvent.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: recTz })
          : null,
    }

    const agingFollowups = await loadAgingFollowups(tenant.id).catch(() => undefined)

    const candidates = recommendationsFromDigest(execDigest, {
      pinnacle,
      pendingApprovals: pendingApprovals ?? 0,
      overdue,
      calendar,
      agingFollowups,
      teamGoals: teamGoals.map((g) => ({
        metric: g.metric,
        total: g.total,
        targetValue: g.targetValue,
        teamName: g.teamName ?? null,
        periodType: g.periodType,
        scope: g.scope,
      })),
    })
    const open = await syncRecommendations(tenant.id, candidates).catch(() => [])
    recommendations = open.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      reasoning: r.reasoning,
      priority: r.priority,
    }))
  }
  // Open project tasks assigned to this member — the PM portal feeding the
  // daily to-do list.
  const myProjectTasks = viewerMember ? await getMyOpenTasks(tenant.id, viewerMember.id) : []
  const navTabs = await buildDashboardTabs(tenant.id, viewerMember)
  // Custom KPI cards (per-member, user-defined widgets). We only show cards
  // the rep has *pinned* to the main dashboard — everything else lives at
  // /dashboard/analytics so the home view doesn't get swamped.
  const kpiCards = viewerMember
    ? await listKpiCards(tenant.id, viewerMember.id, { pinnedOnly: true })
    : []
  const today = new Date().toISOString().slice(0, 10)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6)
  const sevenDaysAgoIso = sevenDaysAgo.toISOString().slice(0, 10)
  let kpiEntriesByCard: Record<string, Array<{ day: string; value: number }>> = {}
  if (kpiCards.length > 0) {
    const { data: entries } = await supabase
      .from('kpi_entries')
      .select('kpi_card_id, day, value')
      .in(
        'kpi_card_id',
        kpiCards.map((c) => c.id),
      )
      .gte('day', sevenDaysAgoIso)
      .order('day', { ascending: true })
    kpiEntriesByCard = (entries ?? []).reduce(
      (acc: Record<string, Array<{ day: string; value: number }>>, row) => {
        const r = row as { kpi_card_id: string; day: string; value: number | string }
        const list = acc[r.kpi_card_id] ?? (acc[r.kpi_card_id] = [])
        list.push({ day: r.day, value: Number(r.value) })
        return acc
      },
      {},
    )
  }
  const gcalConnected = Boolean(googleTokens)
  const gcalConfigured = googleOauthConfigured()
  // Per-member Telegram: each member binds their own chat. The viewer's
  // connect card reflects *their* state, not the account owner's.
  const memberLinkCode = viewerMember?.telegram_link_code ?? null
  const telegramConnected = Boolean(viewerMember?.telegram_chat_id)

  // Hard gate: until Telegram is linked, the rest of the dashboard is locked.
  // The bot is the entire system — no point showing leads / goals / drafts
  // until the rep can talk to it.
  if (!telegramConnected) {
    return (
      <main className="wrap">
        <header className="hero">
          <div>
            <h1>One step left</h1>
            <p className="sub">
              Hi {tenant.display_name} — connect Telegram to unlock your dashboard.
              Your bot <em>is</em> the system: brain dumps, follow-ups, daily briefings,
              calendar events. Nothing works without it.
            </p>
          </div>
        </header>

        <section className="card" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>Connect Telegram to unlock</h2>
            <p>required</p>
          </div>
          <p className="meta" style={{ marginBottom: '0.8rem' }}>
            Open Telegram, message the bot, send your personal link code. Takes 30 seconds.
            This page will refresh automatically once it&apos;s linked.
          </p>
          <ol style={{ paddingLeft: '1.1rem', display: 'grid', gap: '0.5rem', margin: 0 }}>
            <li>
              Open Telegram and message{' '}
              <a
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontWeight: 600, color: 'var(--royal)' }}
              >
                @{botUsername}
              </a>
              . Tap <strong>Start</strong>.
            </li>
            <li>
              Send this exact message:{' '}
              <code
                style={{
                  background: 'var(--panel-2, #fffaea)',
                  border: '1px solid var(--panel-border)',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 6,
                  fontWeight: 600,
                }}
              >
                /link {memberLinkCode ?? '—'}
              </code>
            </li>
            <li>
              Wait for the &ldquo;✅ linked&rdquo; reply, then refresh this page.
            </li>
          </ol>
          <p className="hint" style={{ marginTop: '0.9rem' }}>
            Your code is personal — don&apos;t share it. Need a fresh code?
          </p>
          <form action={onRegenerateLinkCode} style={{ marginTop: '0.3rem' }}>
            <button
              type="submit"
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: 'var(--royal)',
                textDecoration: 'underline',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: '0.85rem',
              }}
            >
              Regenerate code
            </button>
          </form>
        </section>

        <section className="card" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>What unlocks once you link</h2>
          </div>
          <ul style={{ paddingLeft: '1.1rem', display: 'grid', gap: '0.4rem', margin: 0, fontSize: '0.92rem' }}>
            <li>Voice + text brain dumps → tasks, goals, reminders auto-organized</li>
            <li>Morning briefing every weekday at 8am with overdue + priorities</li>
            <li>Hot-lead pings the moment a prospect heats up</li>
            <li>&ldquo;Follow up Dana Thursday&rdquo; → automatic Google Calendar event</li>
            <li>Email drafts for review, sent on approval from the dashboard</li>
          </ul>
        </section>
      </main>
    )
  }

  return (
    <main className="wrap">
      <DashboardAutoRefresh />
      <TimezoneSync />
      <DashboardCustomizer
        initial={
          (((viewerMember?.settings as Record<string, unknown> | undefined)?.dashboard_layout as
            | { visible?: string[]; order?: string[] }
            | undefined) ?? null) as { visible: string[]; order: string[] } | null
        }
      />
      <header className="hero">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1>Command Center</h1>
            <p className="sub">
              Daily pulse for {tenant.display_name}: your goals, prioritized leads, and draft queue.
            </p>
          </div>
          {viewerMember?.telegram_chat_id && (
            <BotInstructionsModal
              botUsername={botUsername}
              activeAddonKeys={navTabs.activeAddonKeys}
              linkCode={memberLinkCode}
              regenerateAction={onRegenerateLinkCode}
              variant="compact"
            />
          )}
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {/* Morning plan — the Plaud overseer's daily briefing + feedback loop.
          Renders only when today's plan exists (agent-gated tenants). */}
      {morningPlan && morningPlan.items.length > 0 && (
        <MorningPlanCard
          plan={morningPlan}
          feedback={morningPlanFeedback}
          feedbackAction={onPlanFeedback}
        />
      )}

      {/* Brand-migration nudge: CXO tenants moved from @VirtualCloserBot to
          @SuiteCxObot. Telegram won't let the new bot message them until they
          open it and tap Start, so this banner walks them through the one-time
          re-link. Auto-dismisses once findTenantByChatId stamps
          settings.cxo_bot_connected (i.e. the moment they message the new bot). */}
      {brandKey === 'cxo' &&
        !((viewerMember?.settings as Record<string, unknown> | undefined)?.cxo_bot_connected) && (
        <section
          style={{
            margin: '1rem 0 0',
            padding: '1rem 1.2rem',
            background: '#2A2A2A',
            color: '#FAF7F0',
            border: '1.5px solid #0D0D0D',
            borderRadius: 14,
            display: 'grid',
            gap: '0.6rem',
          }}
        >
          <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700, color: '#C9C2B0' }}>
            Action needed · One-time setup
          </p>
          <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>
            Switch your assistant to the new CXO Suite bot
          </p>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'rgba(250,247,240,0.85)' }}>
            Your Telegram assistant moved to <strong>@{botUsername}</strong>. Open it, tap
            <strong> Start</strong>, then send the message below to reconnect — everything
            (briefings, brain-dump, deal updates) resumes on the new bot.
          </p>
          <code
            style={{
              fontFamily: "'SF Mono', Menlo, monospace",
              fontSize: 14,
              background: 'rgba(250,247,240,0.12)',
              border: '1px solid rgba(250,247,240,0.25)',
              borderRadius: 8,
              padding: '8px 12px',
              width: 'fit-content',
            }}
          >
            /link {memberLinkCode ?? '—'}
          </code>
          <div>
            <a
              href={`https://t.me/${botUsername}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-block',
                background: '#FAF7F0',
                color: '#2A2A2A',
                fontWeight: 700,
                fontSize: 14,
                textDecoration: 'none',
                padding: '10px 18px',
                borderRadius: 10,
                letterSpacing: '0.02em',
              }}
            >
              Open @{botUsername} →
            </a>
          </div>
        </section>
      )}

      {/* Command Center — exec rollup of what needs the viewer today. CXO only. */}
      {brandKey === 'cxo' && execDigest && (
        <section
          style={{
            margin: '1rem 0 0',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '0.6rem',
          }}
        >
          {[
            {
              label: 'Drafts to approve',
              value: execDigest.pendingDrafts,
              href: '/dashboard/inbox?tab=email',
            },
            {
              label: 'Emails to answer',
              value: execDigest.unansweredThreads,
              href: '/dashboard/inbox?tab=active',
            },
            {
              label: 'Deals gone quiet',
              value: execDigest.quietDeals.length,
              href: '/dashboard/pipeline',
            },
            {
              label: 'Meetings today',
              value: execDigest.todayEvents?.length ?? 0,
              href: '/dashboard/calendar',
            },
          ].map((c) => (
            <Link
              key={c.label}
              href={c.href}
              style={{
                display: 'block',
                textDecoration: 'none',
                background: 'var(--paper)',
                border: '1px solid var(--border-soft)',
                borderRadius: 12,
                padding: '0.9rem 1rem',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: c.value > 0 ? 'var(--accent)' : 'var(--muted)',
                  lineHeight: 1,
                }}
              >
                {c.value}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, fontWeight: 600 }}>
                {c.label}
              </div>
            </Link>
          ))}
        </section>
      )}

      {/* "Today" — Pinnacle revenue + calendar agenda, first thing on cxo. */}
      {brandKey === 'cxo' && (
        <CommandCenterToday
          showPinnacle={showPinnacleStrip}
          events={execDigest?.todayEvents ?? null}
          timezone={viewerMember?.timezone || tenant.timezone || undefined}
        />
      )}

      {brandKey === 'cxo' && recommendations.length > 0 && (
        <RecommendationsCard recommendations={recommendations} />
      )}

      {brandKey === 'cxo' && <ReportIssueCard />}

      <div style={{ margin: '1rem 0 0' }}>
        <FirstRunGuide
          repId={tenant.id}
          supportEmail={getBrand((tenant as { brand?: BrandKey }).brand).supportEmail}
        />
      </div>

      <section className="summary grid-4" data-widget="goals-summary">
        {([
          { key: 'week' as const,    label: 'This week',    cta: '“goal this week: …”' },
          { key: 'month' as const,   label: 'This month',   cta: '“goal this month: …”' },
          { key: 'quarter' as const, label: 'This quarter', cta: '“goal this quarter: …”' },
          { key: 'year' as const,    label: 'This year',    cta: '“goal this year: …”' },
        ]).map(({ key, label, cta }) => {
          const g = findGoal(brain.goals, key)
          return (
            <article key={key} className="card stat">
              <p className="label">{label}</p>
              {g ? (
                <>
                  <p className="value small" style={{ color: 'var(--text)', textTransform: 'none' }}>
                    {g.content}
                  </p>
                  <p className="hint">set {timeAgo(g.created_at)}</p>
                </>
              ) : (
                <>
                  <p className="value small" style={{ color: 'var(--muted)', textTransform: 'none', fontStyle: 'italic' }}>
                    No goal yet
                  </p>
                  <p className="hint">Tell Telegram: {cta}</p>
                </>
              )}
            </article>
          )
        })}
      </section>

      {myProjectTasks.length > 0 && (
        <section className="card" data-widget="my-project-tasks" style={{ marginTop: '0.8rem' }}>
          <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Your project tasks</h2>
            <Link href="/dashboard/projects" style={{ fontSize: '0.85rem', color: 'var(--red)', textDecoration: 'none' }}>
              All projects →
            </Link>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.6rem 0 0', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {myProjectTasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/dashboard/projects/${t.project_id}`}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', border: '1px solid var(--line, #e5e5e5)', borderRadius: 10, padding: '0.6rem 0.8rem', textDecoration: 'none', color: 'inherit' }}
                >
                  <span>
                    <strong style={{ fontWeight: 600 }}>{t.title}</strong>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {t.project_name}
                      {t.status === 'in_progress' ? ' · in progress' : t.status === 'blocked' ? ' · blocked' : ''}
                    </span>
                  </span>
                  {t.time_estimate && (
                    <span style={{ fontSize: '0.72rem', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{t.time_estimate}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Voice features now live in the pill nav above (locked vs. unlocked
          based on active add-ons). The old AI Dialer / Roleplay / Pipeline
          quick-access cards were removed — they were showing for tenants
          who didn't own the feature. */}

      {teamGoals.length > 0 && (
        <section className="card" data-widget="team-goals" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>Team goals</h2>
            <p>{teamGoals.length}</p>
          </div>
          <p className="meta" style={{ marginBottom: '0.8rem' }}>
            Set by your manager. Every call, conversation, meeting and close you log
            rolls into the team total automatically.
          </p>
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {teamGoals.map((g) => {
              const pct = Math.min(100, Math.round((g.total / Math.max(1, g.targetValue)) * 100))
              const yoursPct = Math.min(
                100,
                Math.round((g.yours / Math.max(1, g.targetValue)) * 100),
              )
              const label = g.metric.replace('_', ' ')
              const scopeLabel =
                g.scope === 'account'
                  ? `Whole account · ${g.periodType}`
                  : `${g.teamName ?? 'Team'} · ${g.periodType}`
              return (
                <article
                  key={g.targetId}
                  style={{
                    padding: '0.8rem 1rem',
                    border: '1px solid var(--panel-border, #e8e2d4)',
                    borderRadius: 10,
                    background: 'var(--panel, #fff)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'baseline' }}>
                    <strong style={{ fontSize: '0.95rem' }}>{label}</strong>
                    <span className="meta" style={{ fontSize: '0.78rem' }}>{scopeLabel}</span>
                  </div>
                  <p style={{ margin: '0.3rem 0 0.5rem', fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{g.total}</strong>
                    <span className="meta"> / {g.targetValue}</span>
                    <span className="meta"> · you contributed <strong>{g.yours}</strong></span>
                  </p>
                  <div
                    style={{
                      position: 'relative',
                      height: 10,
                      borderRadius: 999,
                      background: 'var(--panel-2, var(--paper-2))',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: `${pct}%`,
                        background: 'var(--ink)',
                        opacity: 0.18,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: `${yoursPct}%`,
                        background: 'var(--red)',
                      }}
                    />
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Custom KPI cards ─────────────────────────────────────────────
          Reps add these by texting the bot ("100 dials, 25 convos, 5 sets
          today" → bot offers to track them) or via the inline form below.
          Each card shows today's value vs daily goal + a 7-day mini trail. */}
      <section data-widget="custom-kpis" style={{ marginTop: '1.2rem' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '0.8rem',
            marginBottom: '0.6rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Daily KPIs</h2>
            <p className="meta" style={{ margin: '0.2rem 0 0', fontSize: '0.82rem' }}>
              Tell the bot &ldquo;100 dials, 25 convos, 5 sets today&rdquo; and it&rsquo;ll log here.{' '}
              <a
                href="/dashboard/analytics"
                style={{ color: 'var(--accent, var(--red-deep))', fontWeight: 600 }}
              >
                View all in Analytics →
              </a>
            </p>
          </div>
          <NewKpiModal action={onKpiCardCreate} />
        </header>
        {kpiCards.length === 0 ? (
          <article
            style={{
              padding: '1rem 1.1rem',
              border: '1px dashed var(--panel-border)',
              borderRadius: 12,
              background: 'var(--panel)',
              color: 'var(--muted)',
              fontSize: '0.88rem',
            }}
          >
            No KPI cards yet. Add one above, or just text the bot — &ldquo;made 100 dials,
            25 convos, and set 5 appointments today&rdquo; — and it&rsquo;ll offer to pin them here.
          </article>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '0.7rem',
            }}
          >
            {kpiCards.map((card) => {
              const entries = kpiEntriesByCard[card.id] ?? []
              const byDay = new Map(entries.map((e) => [e.day, e.value]))
              const todayVal = byDay.get(today) ?? 0
              const goal = card.goal_value ?? null
              const pct = goal && goal > 0 ? Math.min(100, Math.round((todayVal / goal) * 100)) : null
              // 7-day trail (oldest → newest) — fills missing days with 0
              const trail: Array<{ day: string; value: number }> = []
              for (let i = 6; i >= 0; i--) {
                const d = new Date()
                d.setUTCDate(d.getUTCDate() - i)
                const iso = d.toISOString().slice(0, 10)
                trail.push({ day: iso, value: byDay.get(iso) ?? 0 })
              }
              const maxVal = Math.max(1, goal ?? 0, ...trail.map((t) => t.value))
              return (
                <article
                  key={card.id}
                  style={{
                    padding: '0.9rem 1rem',
                    border: '1px solid var(--border-soft)',
                    background: 'var(--panel, #fff)',
                    borderRadius: 12,
                    display: 'grid',
                    gap: '0.55rem',
                  }}
                >
                  <header
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.75rem',
                          fontWeight: 400,
                          color: 'var(--text-meta)',
                        }}
                      >
                        {card.period === 'day' ? 'Today' : card.period === 'week' ? 'This week' : 'This month'}
                      </p>
                      <strong
                        style={{
                          fontSize: '0.98rem',
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {card.label}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                      <form action={onKpiCardPin}>
                        <input type="hidden" name="cardId" value={card.id} />
                        <input type="hidden" name="pinned" value="0" />
                        <button
                          type="submit"
                          title="Unpin from main dashboard (still shows in Analytics)"
                          style={{
                            background: 'transparent',
                            border: 0,
                            color: 'var(--muted)',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            padding: 0,
                            lineHeight: 1,
                          }}
                        >
                          📌
                        </button>
                      </form>
                      <form action={onKpiCardArchive}>
                        <input type="hidden" name="cardId" value={card.id} />
                        <button
                          type="submit"
                          title="Remove this card"
                          style={{
                            background: 'transparent',
                            border: 0,
                            color: 'var(--muted)',
                            cursor: 'pointer',
                            fontSize: '0.78rem',
                            padding: 0,
                          }}
                        >
                          ×
                        </button>
                      </form>
                    </div>
                  </header>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <span style={{ fontSize: '2.25rem', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                      {todayVal}
                    </span>
                    {goal ? (
                      <span style={{ color: 'var(--text-meta)', fontSize: '0.875rem', fontWeight: 400 }}>
                        / {goal} {pct !== null ? `(${pct}%)` : ''}
                      </span>
                    ) : null}
                    {card.unit ? (
                      <span style={{ color: 'var(--text-meta)', fontSize: '0.875rem', fontWeight: 400 }}>{card.unit}</span>
                    ) : null}
                  </div>
                  {goal && pct !== null ? (
                    <div
                      style={{
                        position: 'relative',
                        height: 6,
                        borderRadius: 999,
                        background: 'var(--panel-2, var(--paper-2))',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: `${pct}%`,
                          background: 'var(--red)',
                        }}
                      />
                    </div>
                  ) : null}
                  {/* 7-day mini bars */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(7, 1fr)',
                      gap: 3,
                      alignItems: 'end',
                      height: 28,
                    }}
                    title={trail
                      .map((t) => `${t.day}: ${t.value}`)
                      .join('\n')}
                  >
                    {trail.map((t) => {
                      const h = Math.max(2, Math.round((t.value / maxVal) * 28))
                      const isToday = t.day === today
                      return (
                        <div
                          key={t.day}
                          style={{
                            height: h,
                            background: isToday ? 'var(--red)' : 'var(--ink)',
                            opacity: isToday ? 1 : 0.22,
                            borderRadius: 2,
                          }}
                        />
                      )
                    })}
                  </div>
                  <form
                    action={onKpiEntryLog}
                    style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}
                  >
                    <input type="hidden" name="cardId" value={card.id} />
                    <input
                      name="value"
                      type="number"
                      min={0}
                      max={1000000}
                      placeholder={`${todayVal}`}
                      style={{
                        flex: 1,
                        padding: '0.35rem 0.55rem',
                        border: '1px solid var(--panel-border)',
                        borderRadius: 6,
                        fontSize: '0.82rem',
                        background: 'var(--panel)',
                        color: 'var(--ink)',
                      }}
                    />
                    <button
                      type="submit"
                      style={{
                        padding: '0.35rem 0.7rem',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        border: '1px solid var(--ink)',
                        background: 'var(--panel)',
                        color: 'var(--ink)',
                        borderRadius: 6,
                        cursor: 'pointer',
                      }}
                    >
                      Log
                    </button>
                  </form>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {viewerMember?.telegram_chat_id ? null : (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>Connect Telegram</h2>
            <p>not connected</p>
          </div>
          <p className="meta" style={{ marginBottom: '0.8rem' }}>
            Your personal assistant on Telegram. Connect it once and every message you send —
            tasks, goals, reminders, notes — drops into your CRM automatically.
          </p>
          <ol style={{ paddingLeft: '1.1rem', display: 'grid', gap: '0.45rem', margin: 0 }}>
            <li>
              Open Telegram and message{' '}
              <a
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontWeight: 600, color: 'var(--royal)' }}
              >
                @{botUsername}
              </a>
              . Tap <strong>Start</strong>.
            </li>
            <li>
              Send this exact message:{' '}
              <code
                style={{
                  // Brand-aware code surface — VC's cream paper-2 (#f7f4ef)
                  // remains; CXO renders its cream-vanilla #EFEAE0 instead
                  // of the previous hardcoded #fffaea warm-vanilla.
                  background: 'var(--paper-2)',
                  border: '1px solid var(--panel-border)',
                  padding: '0.1rem 0.45rem',
                  borderRadius: 6,
                }}
              >
                /link {memberLinkCode ?? '—'}
              </code>
            </li>
            <li>Wait for the confirmation reply. That&apos;s it.</li>
          </ol>
          <p className="hint" style={{ marginTop: '0.7rem' }}>
            Your code is personal — don&apos;t share it.
          </p>
          <form action={onRegenerateLinkCode} style={{ marginTop: '0.3rem' }}>
            <button
              type="submit"
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: 'var(--royal)',
                textDecoration: 'underline',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: '0.82rem',
              }}
            >
              Regenerate code
            </button>
          </form>
        </section>
      )}

      {/* ── Brain-as-nucleus: goals + horizons ───────────────────────── */}
      {brain.goals.length > 0 && (
        <section className="card" data-widget="brain-goals" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>Goals</h2>
            <p>{brain.goals.length} active</p>
          </div>
          <ul className="list">
            {brain.goals.map((g) => (
              <BrainRow key={g.id} item={g} action={onBrainItemAction} />
            ))}
          </ul>
        </section>
      )}

      {brain.overdue.length > 0 && (
        <section className="card" data-widget="brain-overdue" style={{ marginTop: '0.8rem', borderColor: 'rgba(220,38,38,0.4)' }}>
          <div className="section-head">
            <h2 style={{ color: 'var(--alert-fg, #991b1b)' }}>Overdue</h2>
            <p>{brain.overdue.length}</p>
          </div>
          <ul className="list">
            {brain.overdue.map((it) => (
              <BrainRow key={it.id} item={it} action={onBrainItemAction} />
            ))}
          </ul>
        </section>
      )}

      <section className="grid-2" data-widget="brain-today-week" style={{ marginTop: '0.8rem' }}>
        <article className="card">
          <div className="section-head">
            <h2>Today</h2>
            <p>{brain.today.length}</p>
          </div>
          {brain.today.length === 0 ? (
            <p className="empty">Nothing landed for today yet. Tell Telegram what to log.</p>
          ) : (
            <ul className="list">
              {brain.today.map((it) => (
                <BrainRow key={it.id} item={it} action={onBrainItemAction} />
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <div className="section-head">
            <h2>This week</h2>
            <p>{brain.thisWeek.length}</p>
          </div>
          {brain.thisWeek.length === 0 ? (
            <p className="empty">No tasks scheduled for this week.</p>
          ) : (
            <ul className="list">
              {brain.thisWeek.map((it) => (
                <BrainRow key={it.id} item={it} action={onBrainItemAction} />
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="grid-2" data-widget="brain-month-long" style={{ marginTop: '0.8rem' }}>
        <article className="card">
          <div className="section-head">
            <h2>This month</h2>
            <p>{brain.thisMonth.length}</p>
          </div>
          {brain.thisMonth.length === 0 ? (
            <p className="empty">Empty. Tell Jarvis what&apos;s on the radar this month.</p>
          ) : (
            <ul className="list">
              {brain.thisMonth.map((it) => (
                <BrainRow key={it.id} item={it} action={onBrainItemAction} />
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Long range</h2>
            <p>{brain.longRange.length}</p>
          </div>
          {brain.longRange.length === 0 ? (
            <p className="empty">Quarterly + yearly plays show up here.</p>
          ) : (
            <ul className="list">
              {brain.longRange.map((it) => (
                <BrainRow key={it.id} item={it} action={onBrainItemAction} />
              ))}
            </ul>
          )}
        </article>
      </section>

      {brain.inbox.length > 0 && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <details>
            <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
              <strong>Brain inbox</strong>
              <span className="meta">{brain.inbox.length} unsorted</span>
            </summary>
            <ul className="list" style={{ marginTop: '0.5rem' }}>
              {brain.inbox.map((it) => (
                <BrainRow key={it.id} item={it} action={onBrainItemAction} />
              ))}
            </ul>
          </details>
        </section>
      )}

      <section className="grid-2" data-widget="leads-drafts" style={{ marginTop: '0.8rem' }}>
        <article className="card">
          <div className="section-head">
            <h2>Lead Priority Queue</h2>
            <p>{leads.length} total</p>
          </div>

          {leads.length === 0 ? (
            <p className="empty">No leads yet.</p>
          ) : (
            <ul className="list">
              {leads.map((lead) => (
                <li key={lead.id} className="row">
                  <div>
                    <p className="name">{lead.name}</p>
                    <p className="meta">
                      {lead.company || 'No company'}
                      {lead.email ? ` · ${lead.email}` : ''}
                    </p>
                  </div>
                  <div className="right">
                    <span className={statusTone[lead.status] || 'status'}>{lead.status}</span>
                    <p className="meta">Contact: {timeAgo(lead.last_contact)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Pending Email Drafts</h2>
            <p>{pendingDrafts.length} waiting</p>
          </div>

          {pendingDrafts.length === 0 ? (
            <p className="empty">No pending drafts to review.</p>
          ) : (
            <ul className="list drafts">
              {pendingDrafts.map(({ action, lead, draft }) => {
                const gmailHref = lead?.email
                  ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(lead.email)}&su=${encodeURIComponent(draft.subject || '')}&body=${encodeURIComponent(draft.body || '')}`
                  : null
                return (
                  <li key={action.id} className="draft">
                    <p className="name">{lead?.name || 'Unknown lead'} - {lead?.company || 'No company'}</p>
                    <p className="subject">{draft.subject}</p>
                    <p className="body">{draft.body}</p>

                    <div className="actions">
                      <form action={onDraftAction}>
                        <input type="hidden" name="actionId" value={action.id} />
                        <input type="hidden" name="status" value="sent" />
                        <button type="submit" className="btn approve">Approve</button>
                      </form>
                      {gmailHref && (
                        <a
                          href={gmailHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn dismiss"
                          style={{ textDecoration: 'none' }}
                        >
                          Open in Gmail
                        </a>
                      )}
                      <form action={onDraftAction}>
                        <input type="hidden" name="actionId" value={action.id} />
                        <input type="hidden" name="status" value="dismissed" />
                        <button type="submit" className="btn dismiss">Dismiss</button>
                      </form>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </article>
      </section>

    </main>
  )
}

// ── Brain item row (rendered inline in server component, so no 'use client') ─

function BrainRow({
  item,
  action,
}: {
  item: BrainItem
  action: (formData: FormData) => Promise<void>
}) {
  const typeBadge: Record<string, { bg: string; fg: string; label: string }> = {
    task: { bg: 'var(--royal-soft)', fg: 'var(--royal)', label: 'task' },
    goal: { bg: 'rgba(16,185,129,0.15)', fg: '#065f46', label: 'goal' },
    idea: { bg: '#fff7d9', fg: '#7a5500', label: 'idea' },
    plan: { bg: '#ede7ff', fg: '#4a2ea0', label: 'plan' },
    note: { bg: 'var(--paper-2)', fg: 'var(--ink)', label: 'note' },
  }
  const t = typeBadge[item.item_type] ?? typeBadge.note
  const isHigh = item.priority === 'high'
  const due = item.due_date
    ? new Date(item.due_date + 'T00:00:00').toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : null

  return (
    <li className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <p className="name" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '0.7rem',
              padding: '0.1rem 0.45rem',
              borderRadius: 6,
              background: t.bg,
              color: t.fg,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {t.label}
          </span>
          {isHigh && (
            <span
              style={{
                fontSize: '0.7rem',
                padding: '0.1rem 0.45rem',
                borderRadius: 6,
                background: 'rgba(220,38,38,0.12)',
                color: 'var(--alert-fg, #991b1b)',
                fontWeight: 600,
              }}
            >
              HIGH
            </span>
          )}
          <span style={{ fontWeight: 500 }}>{item.content}</span>
        </p>
        <p className="meta">
          {due ? `Due ${due}` : null}
        </p>
      </div>
      <div className="right" style={{ display: 'flex', gap: '0.3rem' }}>
        <form action={action}>
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="status" value="done" />
          <button type="submit" className="btn approve" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}>
            Done
          </button>
        </form>
        <form action={action}>
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="status" value="dismissed" />
          <button type="submit" className="btn dismiss" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}>
            Dismiss
          </button>
        </form>
      </div>
    </li>
  )
}
