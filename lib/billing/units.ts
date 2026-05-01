// Display helpers for the billing layer.
//
// Internal canonical unit is SECONDS for time and CENTS for money — both
// integers, both safe to compare. The UI shows hours and dollars.

export function secondsToHours(secs: number): number {
  return Math.round((secs / 3600) * 10) / 10
}

export function secondsToHoursDisplay(secs: number): string {
  const h = secondsToHours(secs)
  return `${h.toLocaleString('en-US', { maximumFractionDigits: 1 })} hr${h === 1 ? '' : 's'}`
}

export function hoursToSeconds(hours: number): number {
  return Math.round(hours * 3600)
}

export function minutesToSeconds(min: number): number {
  return Math.round(min * 60)
}

export function centsToDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

export function centsToDollarsRound(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`
}

export function plannedVsConsumedPct(plannedSec: number, consumedSec: number): number {
  if (plannedSec <= 0) return 0
  return Math.min(100, Math.round((consumedSec / plannedSec) * 100))
}
