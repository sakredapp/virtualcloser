/**
 * "A calendar outside <company>" (owner 2026-10-17). Pure helpers shared by the
 * Calendar and Integrations pages (no DB, safe anywhere).
 *
 * A company with its own Google client (lib/google.ts resolveOAuthClient,
 * source 'tenant') is Internal at Google: it signs in that company's accounts
 * only. Its people get two ways to add a calendar: another company account
 * (the company's client, unchanged) or an outside calendar (the global client,
 * calendar only). Every other company keeps the single "Add another" button.
 */

/** "Pinnacle Life Group" → "Pinnacle"; "The Acme Co" → "Acme". Empty → null. */
export function companyShortName(company: string | null | undefined): string | null {
  const words = String(company ?? '')
    .trim()
    .replace(/^the\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
  return words[0] ?? null
}

/**
 * The company name to offer the two choices with, or null when the company
 * has no Google client of its own (one button, no labels, as before).
 */
export function outsideCalendarCompany(
  clientSource: 'tenant' | 'global' | null | undefined,
  company: string | null | undefined,
): string | null {
  if (clientSource !== 'tenant') return null
  return companyShortName(company) ?? 'company'
}

/** The small label next to an account: "Pinnacle account" / "Outside calendar"; null = no label. */
export function googleAccountKindLabel(
  account: { calendarOnly?: boolean | null },
  company: string | null,
): string | null {
  if (account.calendarOnly) return 'Outside calendar'
  if (!company) return null
  return company === 'company' ? 'Company account' : `${company} account`
}

/** The two choices' words. A company with no usable name reads "company" / "the company". */
export function addChoiceLabels(company: string): { company: string; outside: string } {
  const named = company !== 'company'
  return {
    company: `Another ${company} account`,
    outside: `A calendar outside ${named ? company : 'the company'}`,
  }
}

export const OUTSIDE_CALENDAR_HINT = 'Personal Gmail or another company. Calendar only.'

/** The two "add" links (return = a /dashboard path). */
export function addCalendarHrefs(returnPath: string): { company: string; outside: string } {
  const ret = encodeURIComponent(returnPath)
  return {
    company: `/api/google/oauth/start?add=1&return=${ret}`,
    outside: `/api/google/oauth/start?add=1&outside=1&return=${ret}`,
  }
}
