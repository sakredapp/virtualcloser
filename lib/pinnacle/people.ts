/**
 * Team page people stats (headcount, onboarding, retention). Built in SQL by
 * pinnacle_build_people_stats() after every swept sync and cached in the one
 * row of pinnacle_people_rollup (supabase/pinnacle_people_stats.sql).
 */
import { supabase } from '@/lib/supabase'

export type PeopleMonth = { m: string; joined: number; still_active: number; inactive: number; wrote: number; median_days: number | null }
export type PersistencyPair = { new_paid: number; new_total: number; rest_paid: number; rest_total: number }
export type RetentionPoint = { k: number; n: number; writing: number }
export type ApproachingAgent = {
  id: string
  name: string
  team: string
  months_in: number
  last_wrote: string | null
  recent_n: number
  prior_n: number
  recent_ap: number
  prior_ap: number
}
export type Retention = {
  since: string
  window_days: number
  milestones: Partial<Record<'m3' | 'm6' | 'm10' | 'm12' | 'm24', { n: number; writing: number }>>
  curve: RetentionPoint[]
  cohorts: Array<{ q: string; start: string; points: RetentionPoint[] }>
  flow: Array<{ m: string; joined: number; left: number; headcount: number; partial: boolean }>
  turnover: { from: string; to: string; left: number; avg_headcount: number | null; months: number }
  washout: { eligible: number; never: number; stopped90: number }
  approaching: ApproachingAgent[]
  approaching_total: number
}
export type PeopleStats = {
  today: string
  book_start: string
  fill: Record<string, number>
  policies_linked_pct: number | null
  roster: number
  active: number
  agencies: number
  writing30: number
  writing90: number
  new30: number
  writing365?: number
  new90?: number
  new365?: number
  retention?: Retention
  writers_by_month: Array<{ m: string; n: number }>
  joins_by_month: PeopleMonth[]
  first_policy: {
    joiners: number
    wrote: number
    median_days: number | null
    eligible30: number
    within30: number
    eligible60: number
    within60: number
    eligible90: number
    within90: number
    reached5k: number
    median5k: number | null
    reached10k: number
    median10k: number | null
  }
  persistency6: Record<string, PersistencyPair> | null
}

export async function loadPeopleStats(): Promise<{ data: PeopleStats; computedAt: string } | null> {
  const { data, error } = await supabase.from('pinnacle_people_rollup').select('data, computed_at').eq('id', 1).maybeSingle()
  if (error || !data) return null
  return { data: data.data as PeopleStats, computedAt: data.computed_at as string }
}
