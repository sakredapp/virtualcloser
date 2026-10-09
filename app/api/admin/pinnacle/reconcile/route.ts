/**
 * GET /api/admin/pinnacle/reconcile
 *
 * Mirror vs Airtable, side by side, so every number on the executive pages
 * can be checked against the source of truth before it is shown.
 *
 *   mirror  — what the suite reads (pinnacle_premium_daily / status rollups,
 *             master base, bucketed by Airtable "Effective Date")
 *   live    — the same sums pulled straight from Airtable right now
 *             (every policy table in the master base, paginated)
 *
 * Gate: admin session cookie OR `Authorization: Bearer <CRON_SECRET>`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { supabase } from '@/lib/supabase'
import { fetchAirtableTable, getBases } from '@/lib/pinnacle/airtable'
import { PINNACLE_BASE_ID, fetchPremiumSeries, fetchStatusSeries, type DailyRow, type StatusRow } from '@/lib/pinnacle/rollup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const AP_FIELD = 'Annual Premium'
const DATE_FIELD = 'Effective Date'
const STATUS_FIELD = 'Summary Status'
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/

/** Same rule as pinnacle_rebuild_rollups(): which statuses count as issued. */
export function isIssuedStatus(status: string): boolean {
  const s = status.toLowerCase()
  return s.includes('issue - paid') || s.includes('issue-paid') || s.includes('funded')
}
function isPolicyTable(name: string): boolean {
  const n = name.toLowerCase()
  return !n.includes('directory') && !n.includes('agent list') && !n.includes('rolling')
}
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}
function round(n: number): number {
  return Math.round(n * 100) / 100
}

type Bucket = { records: number; submitted_ap: number; issued_ap: number; policies_issued: number }
const empty = (): Bucket => ({ records: 0, submitted_ap: 0, issued_ap: 0, policies_issued: 0 })

function monthKeys(today: string): string[] {
  const out: string[] = []
  const [y, m] = today.split('-').map(Number)
  for (let i = 12; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

export async function GET(req: NextRequest) {
  const authed = (await isAdminAuthed()) || isAuthorizedCron(req.headers.get('authorization'))
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const today = new Date().toISOString().slice(0, 10)
  const year = today.slice(0, 4)
  const thisMonth = today.slice(0, 7)
  const months = monthKeys(today)
  const liveWanted = req.nextUrl.searchParams.get('live') !== '0'

  // ── Mirror ──────────────────────────────────────────────────────────────
  const [series, statuses, runsRes] = await Promise.all([
    fetchPremiumSeries().catch((e: Error) => ({ error: e.message })),
    fetchStatusSeries().catch((e: Error) => ({ error: e.message })),
    supabase.from('pinnacle_airtable_sync_runs').select('started_at, finished_at, ok, error, tables').order('started_at', { ascending: false }).limit(3),
  ])

  const mirrorByMonth: Record<string, Bucket> = Object.fromEntries(months.map((m) => [m, empty()]))
  const mirrorYtd = empty()
  let mirrorEarliest: string | null = null
  let mirrorLatest: string | null = null
  if (Array.isArray(series)) {
    for (const r of series as DailyRow[]) {
      if (r.base_id !== PINNACLE_BASE_ID) continue
      if (!mirrorEarliest || r.d < mirrorEarliest) mirrorEarliest = r.d
      if (!mirrorLatest || r.d > mirrorLatest) mirrorLatest = r.d
      const m = r.d.slice(0, 7)
      const add = (b: Bucket) => {
        b.records += Number(r.policies) || 0
        b.submitted_ap += Number(r.premium) || 0
        b.issued_ap += Number(r.funded_premium) || 0
        b.policies_issued += Number(r.funded_policies) || 0
      }
      if (mirrorByMonth[m]) add(mirrorByMonth[m])
      if (r.d >= `${year}-01-01` && r.d <= today) add(mirrorYtd)
    }
  }
  const mirrorStatus = { total: 0, paid: 0, declined: 0, lapsed: 0, submitted: 0 }
  if (Array.isArray(statuses)) {
    for (const r of statuses as StatusRow[]) {
      mirrorStatus.total += Number(r.total) || 0
      mirrorStatus.paid += Number(r.paid) || 0
      mirrorStatus.declined += Number(r.declined) || 0
      mirrorStatus.lapsed += Number(r.lapsed) || 0
      mirrorStatus.submitted += Number(r.submitted) || 0
    }
  }

  const runs = (runsRes.data ?? []) as Array<{ started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; tables: unknown }>
  const lastRun = runs[0]
    ? {
        ...runs[0],
        records_touched: (() => {
          let fetched = 0
          let upserted = 0
          const t = runs[0].tables as Array<{ baseId: string; tables: Record<string, { fetched?: number; upserted?: number }> }> | null
          for (const b of t ?? []) for (const v of Object.values(b.tables ?? {})) {
            fetched += v.fetched ?? 0
            upserted += v.upserted ?? 0
          }
          return { fetched, upserted }
        })(),
      }
    : null

  // ── Live Airtable (source of truth) ─────────────────────────────────────
  const base = getBases().find((b) => b.baseId === PINNACLE_BASE_ID)
  const liveByMonth: Record<string, Bucket> = Object.fromEntries(months.map((m) => [m, empty()]))
  const liveYtd = empty()
  const liveAll = empty()
  const liveStatus: Record<string, number> = {}
  const liveTables: Array<{ table: string; records: number; bad_dates: number; error?: string }> = []
  let liveLatest: string | null = null
  if (liveWanted && base) {
    for (const table of base.tables.filter(isPolicyTable)) {
      try {
        const recs = await fetchAirtableTable(PINNACLE_BASE_ID, table, { fields: [AP_FIELD, DATE_FIELD, STATUS_FIELD] })
        let bad = 0
        for (const r of recs) {
          const d = String(r.fields[DATE_FIELD] ?? '')
          const status = String(r.fields[STATUS_FIELD] ?? '')
          const ap = num(r.fields[AP_FIELD])
          liveStatus[status || '(blank)'] = (liveStatus[status || '(blank)'] ?? 0) + 1
          if (!DATE_RE.test(d)) {
            bad++
            continue
          }
          if (!liveLatest || d > liveLatest) liveLatest = d
          const issued = isIssuedStatus(status)
          const add = (b: Bucket) => {
            b.records += 1
            b.submitted_ap += ap
            if (issued) {
              b.issued_ap += ap
              b.policies_issued += 1
            }
          }
          add(liveAll)
          const m = d.slice(0, 7)
          if (liveByMonth[m]) add(liveByMonth[m])
          if (d >= `${year}-01-01` && d <= today) add(liveYtd)
        }
        liveTables.push({ table, records: recs.length, bad_dates: bad })
      } catch (err) {
        liveTables.push({ table, records: 0, bad_dates: 0, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  const side = (label: string, mirror: Bucket, live: Bucket | null) => ({
    period: label,
    mirror: { records: mirror.records, submitted_ap: round(mirror.submitted_ap), issued_ap: round(mirror.issued_ap), policies_issued: mirror.policies_issued },
    live: live ? { records: live.records, submitted_ap: round(live.submitted_ap), issued_ap: round(live.issued_ap), policies_issued: live.policies_issued } : null,
    delta: live
      ? {
          records: live.records - mirror.records,
          submitted_ap: round(live.submitted_ap - mirror.submitted_ap),
          submitted_ap_pct: live.submitted_ap ? round(((mirror.submitted_ap - live.submitted_ap) / live.submitted_ap) * 100) : null,
          issued_ap: round(live.issued_ap - mirror.issued_ap),
          policies_issued: live.policies_issued - mirror.policies_issued,
        }
      : null,
  })
  const haveLive = liveWanted && !!base && liveTables.some((t) => !t.error)
  const mtd = side(`${thisMonth} (month to date)`, mirrorByMonth[thisMonth], haveLive ? liveByMonth[thisMonth] : null)
  const ytdRow = side(`${year} year to date`, mirrorYtd, haveLive ? liveYtd : null)
  const mtdPct = mtd.delta?.submitted_ap_pct
  const reconciled = mtdPct !== null && mtdPct !== undefined && Math.abs(mtdPct) <= 1

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    today,
    definitions: {
      date_bucket: `Airtable "${DATE_FIELD}" (policy effective date) for every bucket: premium, status and breakdowns. Not the submit date or the issue/paid date.`,
      submitted_ap: `sum of "${AP_FIELD}" over every record, any status`,
      issued_ap: `sum of "${AP_FIELD}" where "${STATUS_FIELD}" contains "issue - paid", "issue-paid" or "funded"`,
      sync: 'full pull of every configured table each run (not incremental), upsert by record id, then pinnacle_rebuild_rollups()',
      scope: 'Pinnacle master base only (the agency books are separate base ids); Health, Life and Annuity by table name',
    },
    last_sync: lastRun,
    recent_syncs: runs.slice(1),
    mirror: {
      earliest_effective_date: mirrorEarliest,
      latest_effective_date: mirrorLatest,
      status_counts_master_base: mirrorStatus,
      error: !Array.isArray(series) ? (series as { error: string }).error : !Array.isArray(statuses) ? (statuses as { error: string }).error : null,
    },
    live: haveLive
      ? {
          base_id: PINNACLE_BASE_ID,
          tables: liveTables,
          records_in_policy_tables: liveAll.records,
          latest_effective_date: liveLatest,
          distinct_summary_status: Object.entries(liveStatus)
            .sort((a, b) => b[1] - a[1])
            .map(([status, count]) => ({ status, count, counted_as_issued: isIssuedStatus(status) })),
          all_time: { records: liveAll.records, submitted_ap: round(liveAll.submitted_ap), issued_ap: round(liveAll.issued_ap), policies_issued: liveAll.policies_issued },
        }
      : { skipped: !base ? 'master base not in PINNACLE_AIRTABLE_BASES' : liveWanted ? 'every table failed' : 'live=0', tables: liveTables },
    month_to_date: mtd,
    year_to_date: ytdRow,
    months: months.map((m) => side(m, mirrorByMonth[m], haveLive ? liveByMonth[m] : null)),
    verdict: {
      mtd_within_1pct: reconciled,
      note: reconciled
        ? 'Month to date reconciles with Airtable within 1%: projections may be shown.'
        : haveLive
          ? 'Month to date does NOT reconcile within 1%: run the sync and re-check; hide projections until it does.'
          : 'No live comparison was made.',
    },
  })
}
