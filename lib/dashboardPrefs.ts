/**
 * Dashboard preferences — the layout an executive (or their AI, through
 * /api/mcp) has chosen for the Suite CXO dashboard.
 *
 * Stored per account under `reps.settings.dashboard_prefs`. Read with
 * `getDashboardPrefs(repId)`, change with `setDashboardPrefs(repId, patch)`;
 * both return the full normalized object so a caller never has to merge.
 *
 * Every value is validated against a closed catalog (tiles, timeframes, KPIs,
 * breakdown dims) so an AI cannot write a layout the dashboard cannot draw.
 */

import { supabase } from '@/lib/supabase'
import { BREAKDOWN_DIMS, type BreakdownDim } from '@/lib/pinnacle/rollup'

export const DASHBOARD_PREFS_KEY = 'dashboard_prefs'

/** Tiles the dashboard can draw, in the order they appear by default. */
export const DASHBOARD_TILES = [
  'headline',
  'kpis',
  'premium_trend',
  'product_mix',
  'status_funnel',
  'breakdowns',
  'agency_books',
  'meetings',
  'notes',
] as const
export type DashboardTile = (typeof DASHBOARD_TILES)[number]

export const TILE_LABELS: Record<DashboardTile, string> = {
  headline: 'Headline note and the one number that matters this week',
  kpis: 'KPI strip (issued premium, placement, policies)',
  premium_trend: 'Issued premium trend chart',
  product_mix: 'Product mix: Health / Life / Annuity',
  status_funnel: 'Submitted → issued → paid funnel with declines and lapses',
  breakdowns: 'Breakdown tables by agency, producer, carrier, state, product',
  agency_books: 'Agency books of business side by side',
  meetings: 'Upcoming meetings',
  notes: 'Notes left for the team',
}

export const DASHBOARD_TIMEFRAMES = ['mtd', 'qtd', 'ytd', '3m', '6m', '12m', 'all'] as const
export type DashboardTimeframe = (typeof DASHBOARD_TIMEFRAMES)[number]

export const TIMEFRAME_LABELS: Record<DashboardTimeframe, string> = {
  mtd: 'Month to date',
  qtd: 'Quarter to date',
  ytd: 'Year to date',
  '3m': 'Trailing 3 months',
  '6m': 'Trailing 6 months',
  '12m': 'Trailing 12 months',
  all: 'All time',
}

export const DASHBOARD_KPIS = [
  'ytd_premium',
  'mtd_premium',
  'trailing_3m_premium',
  'trailing_6m_premium',
  'trailing_12m_premium',
  'policies_issued',
  'policies_submitted',
  'placement_pct',
  'avg_premium_per_policy',
  'projected_month_end',
] as const
export type DashboardKpi = (typeof DASHBOARD_KPIS)[number]

export const KPI_LABELS: Record<DashboardKpi, string> = {
  ytd_premium: 'Issued premium, year to date',
  mtd_premium: 'Issued premium, month to date',
  trailing_3m_premium: 'Issued premium, trailing 3 months',
  trailing_6m_premium: 'Issued premium, trailing 6 months',
  trailing_12m_premium: 'Issued premium, trailing 12 months',
  policies_issued: 'Policies issued',
  policies_submitted: 'Policies submitted',
  placement_pct: 'Placement rate',
  avg_premium_per_policy: 'Average premium per policy',
  projected_month_end: 'Projected month-end premium',
}

export type DashboardNote = {
  id: string
  text: string
  author: string
  created_at: string
}

export type DashboardPrefs = {
  version: 1
  /** Visible tiles, in order. Anything not listed is hidden. */
  tiles: DashboardTile[]
  default_timeframe: DashboardTimeframe
  pinned_kpis: DashboardKpi[]
  pinned_breakdowns: BreakdownDim[]
  /** Free-form section keys the dashboard hides (for sub-sections inside a tile). */
  hidden_sections: string[]
  /** A one-line note shown at the top of the dashboard. Null = none. */
  headline_note: string | null
  notes: DashboardNote[]
  updated_at: string | null
  updated_by: 'app' | 'mcp' | null
}

export type DashboardPrefsPatch = Partial<
  Pick<
    DashboardPrefs,
    'tiles' | 'default_timeframe' | 'pinned_kpis' | 'pinned_breakdowns' | 'hidden_sections' | 'headline_note'
  >
> & {
  /** Notes to append (never replaces existing notes). */
  add_notes?: Array<{ text: string; author?: string }>
  /** Note ids to remove. */
  remove_note_ids?: string[]
  updated_by?: 'app' | 'mcp'
}

export const DEFAULT_DASHBOARD_PREFS: DashboardPrefs = {
  version: 1,
  tiles: [...DASHBOARD_TILES],
  default_timeframe: 'ytd',
  pinned_kpis: ['ytd_premium', 'trailing_12m_premium', 'placement_pct', 'policies_issued'],
  pinned_breakdowns: ['agent', 'carrier'],
  hidden_sections: [],
  headline_note: null,
  notes: [],
  updated_at: null,
  updated_by: null,
}

const MAX_NOTE_LEN = 600
const MAX_HEADLINE_LEN = 200
const MAX_NOTES = 50
const MAX_HIDDEN = 40

function uniqIn<T extends string>(values: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(values)) return []
  const out: T[] = []
  for (const v of values) {
    if (typeof v !== 'string') continue
    const key = v.trim() as T
    if ((allowed as readonly string[]).includes(key) && !out.includes(key)) out.push(key)
  }
  return out
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function noteId(): string {
  return `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Coerce anything stored (or sent) into a valid DashboardPrefs. */
export function normalizeDashboardPrefs(raw: unknown): DashboardPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tiles = uniqIn(r.tiles, DASHBOARD_TILES)
  const tf = typeof r.default_timeframe === 'string' ? r.default_timeframe : ''
  const notesRaw = Array.isArray(r.notes) ? r.notes : []
  const notes: DashboardNote[] = []
  for (const n of notesRaw) {
    if (!n || typeof n !== 'object') continue
    const o = n as Record<string, unknown>
    const text = cleanText(o.text, MAX_NOTE_LEN)
    if (!text) continue
    notes.push({
      id: typeof o.id === 'string' && o.id ? o.id : noteId(),
      text,
      author: typeof o.author === 'string' && o.author ? o.author : 'Unknown',
      created_at: typeof o.created_at === 'string' ? o.created_at : new Date().toISOString(),
    })
  }
  return {
    version: 1,
    tiles: tiles.length ? tiles : [...DEFAULT_DASHBOARD_PREFS.tiles],
    default_timeframe: (DASHBOARD_TIMEFRAMES as readonly string[]).includes(tf)
      ? (tf as DashboardTimeframe)
      : DEFAULT_DASHBOARD_PREFS.default_timeframe,
    pinned_kpis: Array.isArray(r.pinned_kpis) ? uniqIn(r.pinned_kpis, DASHBOARD_KPIS) : [...DEFAULT_DASHBOARD_PREFS.pinned_kpis],
    pinned_breakdowns: Array.isArray(r.pinned_breakdowns)
      ? uniqIn(r.pinned_breakdowns, BREAKDOWN_DIMS)
      : [...DEFAULT_DASHBOARD_PREFS.pinned_breakdowns],
    hidden_sections: Array.isArray(r.hidden_sections)
      ? r.hidden_sections
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .map((s) => s.trim().slice(0, 60))
          .slice(0, MAX_HIDDEN)
      : [],
    headline_note: cleanText(r.headline_note, MAX_HEADLINE_LEN),
    notes: notes.slice(-MAX_NOTES),
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
    updated_by: r.updated_by === 'app' || r.updated_by === 'mcp' ? r.updated_by : null,
  }
}

async function readSettings(repId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('reps').select('settings').eq('id', repId).maybeSingle()
  if (error) throw new Error(`dashboard_prefs read: ${error.message}`)
  const s = (data as { settings?: unknown } | null)?.settings
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : {}
}

/** The account's dashboard preferences, defaults applied. Never throws on a missing key. */
export async function getDashboardPrefs(repId: string): Promise<DashboardPrefs> {
  const settings = await readSettings(repId)
  return normalizeDashboardPrefs(settings[DASHBOARD_PREFS_KEY])
}

/**
 * Merge a patch into the stored preferences and persist. Arrays in the patch
 * REPLACE the stored array (so "show only these tiles" works); notes are
 * append/remove only. Returns the full new preferences.
 */
export async function setDashboardPrefs(repId: string, patch: DashboardPrefsPatch): Promise<DashboardPrefs> {
  const settings = await readSettings(repId)
  const current = normalizeDashboardPrefs(settings[DASHBOARD_PREFS_KEY])

  const merged: Record<string, unknown> = { ...current }
  if (patch.tiles !== undefined) merged.tiles = patch.tiles
  if (patch.default_timeframe !== undefined) merged.default_timeframe = patch.default_timeframe
  if (patch.pinned_kpis !== undefined) merged.pinned_kpis = patch.pinned_kpis
  if (patch.pinned_breakdowns !== undefined) merged.pinned_breakdowns = patch.pinned_breakdowns
  if (patch.hidden_sections !== undefined) merged.hidden_sections = patch.hidden_sections
  if (patch.headline_note !== undefined) merged.headline_note = patch.headline_note

  let notes = [...current.notes]
  if (patch.remove_note_ids?.length) {
    const drop = new Set(patch.remove_note_ids)
    notes = notes.filter((n) => !drop.has(n.id))
  }
  for (const n of patch.add_notes ?? []) {
    const text = cleanText(n.text, MAX_NOTE_LEN)
    if (!text) continue
    notes.push({ id: noteId(), text, author: n.author?.trim() || 'Unknown', created_at: new Date().toISOString() })
  }
  merged.notes = notes
  merged.updated_at = new Date().toISOString()
  merged.updated_by = patch.updated_by ?? 'app'

  const next = normalizeDashboardPrefs(merged)
  const { error } = await supabase
    .from('reps')
    .update({ settings: { ...settings, [DASHBOARD_PREFS_KEY]: next } })
    .eq('id', repId)
  if (error) throw new Error(`dashboard_prefs write: ${error.message}`)
  return next
}

/** Human-readable catalog, for the MCP layout tool and for docs. */
export function describeDashboardCatalog() {
  return {
    tiles: DASHBOARD_TILES.map((id) => ({ id, label: TILE_LABELS[id] })),
    timeframes: DASHBOARD_TIMEFRAMES.map((id) => ({ id, label: TIMEFRAME_LABELS[id] })),
    kpis: DASHBOARD_KPIS.map((id) => ({ id, label: KPI_LABELS[id] })),
    breakdowns: [...BREAKDOWN_DIMS],
  }
}
