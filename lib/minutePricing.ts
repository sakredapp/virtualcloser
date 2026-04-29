// ============================================================================
// Minute-based pricing for AI Dialer + Roleplay.
//
// Customers buy a CAP of minutes per month at a flat per-minute rate. The
// cap is a hard-stop (`client_addons.cap_value`) — admin sets it when
// finalizing the build on the prospect/quote page; runtime entitlement
// checks (`assertCanUse` → `usageFor`) read it.
//
// Public pages use these helpers so what the customer agrees to is exactly
// what we cap them at.
// ============================================================================

import type { AddonKey } from '@/lib/addons'

// Retail rates in cents-per-minute. Keep simple, round numbers.
// Vendor blended cost (Vapi): dialer ~$0.20/min · roleplay ~$0.18/min.
// Margins: dialer ~55% · roleplay ~48%.
export const AI_DIALER_CENTS_PER_MIN = 45 // $0.45 / min
export const ROLEPLAY_CENTS_PER_MIN = 35 // $0.35 / min

// Conversion factor for the dialer "≈ N appts" hint shown to customers.
// One confirmed appt averages ~3 minutes (confirm leg + small reschedule
// share + voicemails). Tune if our actual blended call duration drifts.
export const APPT_AVG_MINUTES = 3

export const DIALER_KEY: AddonKey = 'addon_dialer_pro'
export const ROLEPLAY_KEY: AddonKey = 'addon_roleplay_pro'

// Slider UX bounds (minutes / month). Step is intentionally chunky so
// the slider feels stable and snaps to "real" caps the admin would set.
export const DIALER_MIN_STEP = 0
export const DIALER_MAX_STEP = 3000
export const DIALER_STEP = 30

export const ROLEPLAY_MIN_STEP = 0
export const ROLEPLAY_MAX_STEP = 3000
export const ROLEPLAY_STEP = 30

export function dialerMonthlyCents(minutes: number): number {
  if (minutes <= 0) return 0
  return Math.round(minutes * AI_DIALER_CENTS_PER_MIN)
}

export function roleplayMonthlyCents(minutes: number): number {
  if (minutes <= 0) return 0
  return Math.round(minutes * ROLEPLAY_CENTS_PER_MIN)
}

export function approxAppts(minutes: number): number {
  return Math.round(minutes / APPT_AVG_MINUTES)
}
