/**
 * Team-goal helpers. Goals set by leadership show on each member's dashboard
 * goal cards; nothing is pushed to anyone.
 */

import type { Target, TargetMetric, TargetPeriod } from '@/types'

const METRIC_LABEL: Record<TargetMetric, string> = {
  calls: 'calls',
  conversations: 'conversations',
  meetings_booked: 'meetings booked',
  deals_closed: 'deals closed',
  revenue: 'revenue',
  custom: 'custom metric',
}

const PERIOD_LABEL: Record<TargetPeriod, string> = {
  day: 'today',
  week: 'this week',
  month: 'this month',
  quarter: 'this quarter',
  year: 'this year',
}

export function describeTarget(t: Pick<Target, 'metric' | 'target_value' | 'period_type'>): string {
  return `${t.target_value} ${METRIC_LABEL[t.metric] ?? t.metric} ${PERIOD_LABEL[t.period_type] ?? t.period_type}`
}
