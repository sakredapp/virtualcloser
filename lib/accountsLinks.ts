/**
 * Client onboarding and management live in Accounts (crmbuilds,
 * accounts.virtualcloser.com) since 2026-10-19. The old Suite CXO admin pages
 * (/admin/clients, /new, /[id], /[id]/members, /[id]/cost) answer with a
 * permanent redirect there (app/admin/clients/[[...path]]/route.ts).
 *
 * Accounts reads Suite CXO through GET /api/ops/onboarding (lib/opsOnboarding).
 * Its Suite CXO clients are reps rows, not Accounts agencies, so a known
 * client is the brand list narrowed with &rep=<reps.id>.
 */
export const ACCOUNTS_ONBOARDING_URL = 'https://accounts.virtualcloser.com/accounts/onboarding'

const REP_ID_RE = /^[A-Za-z0-9_-]{1,80}$/

/** The Suite CXO onboarding list in Accounts, or one client in it. */
export function accountsOnboardingUrl(repId?: string | null): string {
  const u = new URL(ACCOUNTS_ONBOARDING_URL)
  u.searchParams.set('brand', 'suitecxo')
  const id = (repId ?? '').trim()
  if (id && REP_ID_RE.test(id)) u.searchParams.set('rep', id)
  return u.toString()
}

/**
 * Where an old /admin/clients path goes. `segments` is the path after
 * /admin/clients: [] and ['new'] are the list, ['<id>', ...] is that client.
 */
export function accountsUrlForAdminClientsPath(segments: readonly string[] | undefined): string {
  const first = segments?.[0]
  if (!first || first === 'new') return accountsOnboardingUrl()
  let id = first
  try {
    id = decodeURIComponent(first)
  } catch {
    /* keep it as sent; the pattern check below drops anything odd */
  }
  return accountsOnboardingUrl(id)
}
