import { supabase } from '@/lib/supabase'

export type TransferAvailabilityRow = {
  id: string
  rep_id: string
  member_id: string
  day_of_week: number
  start_local: string
  end_local: string
  timezone: string | null
  accepts_live_transfer: boolean
}

/**
 * Returns member IDs currently eligible to receive live transfers for a rep,
 * based on enterprise availability windows.
 */
export async function getAvailableTransferMemberIdsNow(repId: string): Promise<string[]> {
  const now = new Date()

  const { data, error } = await supabase
    .from('dialer_transfer_availability')
    .select('id, rep_id, member_id, day_of_week, start_local, end_local, timezone, accepts_live_transfer')
    .eq('rep_id', repId)
    .eq('accepts_live_transfer', true)

  if (error) throw error
  const rows = (data ?? []) as TransferAvailabilityRow[]
  if (!rows.length) return []

  const active = new Set<string>()
  for (const row of rows) {
    const tz = row.timezone || 'UTC'
    if (isWindowActive(now, row.day_of_week, row.start_local, row.end_local, tz)) {
      active.add(row.member_id)
    }
  }

  return Array.from(active)
}

/**
 * Check if a local weekly window is active at a given timestamp.
 */
export function isWindowActive(
  nowUtc: Date,
  dayOfWeek: number,
  startLocal: string,
  endLocal: string,
  timezone: string,
): boolean {
  const parts = getLocalParts(nowUtc, timezone)
  if (!parts) return false
  if (parts.dayOfWeek !== dayOfWeek) return false

  const currentSeconds = parts.hour * 3600 + parts.minute * 60 + parts.second
  const startSeconds = parseTimeToSeconds(startLocal)
  const endSeconds = parseTimeToSeconds(endLocal)
  if (startSeconds == null || endSeconds == null) return false

  return currentSeconds >= startSeconds && currentSeconds < endSeconds
}

function parseTimeToSeconds(v: string): number | null {
  const m = v.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  const ss = m[3] ? Number(m[3]) : 0
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null
  return hh * 3600 + mm * 60 + ss
}

function getLocalParts(nowUtc: Date, timezone: string): { dayOfWeek: number; hour: number; minute: number; second: number } | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const parts = formatter.formatToParts(nowUtc)
    const weekday = parts.find((p) => p.type === 'weekday')?.value
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    const second = Number(parts.find((p) => p.type === 'second')?.value ?? '0')

    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    }

    if (!weekday || dayMap[weekday] == null) return null
    return { dayOfWeek: dayMap[weekday], hour, minute, second }
  } catch {
    return null
  }
}
