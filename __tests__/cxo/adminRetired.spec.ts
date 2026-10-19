import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { accountsOnboardingUrl, accountsUrlForAdminClientsPath, ACCOUNTS_ONBOARDING_URL } from '@/lib/accountsLinks'
import { isPurchaseHref } from '@/lib/nativeApp'

// Owner 2026-10-19: Suite CXO's admin onboarding is retired. Every client is
// onboarded in Accounts (accounts.virtualcloser.com/accounts/onboarding).
const root = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')
const LIST = `${ACCOUNTS_ONBOARDING_URL}?brand=suitecxo`

describe('the Accounts link', () => {
  it('is the Suite CXO list, or one client in it', () => {
    expect(accountsOnboardingUrl()).toBe(LIST)
    expect(accountsOnboardingUrl('rep_acme')).toBe(`${LIST}&rep=rep_acme`)
  })

  it('drops an id that is not a plain rep id', () => {
    expect(accountsOnboardingUrl('a b&x=1')).toBe(LIST)
    expect(accountsOnboardingUrl('')).toBe(LIST)
    expect(accountsOnboardingUrl(null)).toBe(LIST)
  })

  it('maps every old /admin/clients path', () => {
    expect(accountsUrlForAdminClientsPath(undefined)).toBe(LIST)
    expect(accountsUrlForAdminClientsPath([])).toBe(LIST)
    expect(accountsUrlForAdminClientsPath(['new'])).toBe(LIST)
    expect(accountsUrlForAdminClientsPath(['rep_acme'])).toBe(`${LIST}&rep=rep_acme`)
    expect(accountsUrlForAdminClientsPath(['rep_acme', 'members'])).toBe(`${LIST}&rep=rep_acme`)
    expect(accountsUrlForAdminClientsPath(['rep_acme', 'cost'])).toBe(`${LIST}&rep=rep_acme`)
  })
})

describe('old admin URLs answer with a permanent redirect', () => {
  const call = async (mod: { GET: (req: Request, ctx: { params: Promise<{ path?: string[] }> }) => Promise<Response> }, segs?: string[]) =>
    mod.GET(new Request('https://suitecxo.com/admin/x'), { params: Promise.resolve({ path: segs }) })

  it('/admin/clients and every page under it', async () => {
    const mod = await import('@/app/admin/clients/[[...path]]/route')
    const cases: Array<[string[] | undefined, string]> = [
      [undefined, LIST],
      [['new'], LIST],
      [['rep_acme'], `${LIST}&rep=rep_acme`],
      [['rep_acme', 'members'], `${LIST}&rep=rep_acme`],
      [['rep_acme', 'cost'], `${LIST}&rep=rep_acme`],
    ]
    for (const [segs, to] of cases) {
      const res = await call(mod, segs)
      expect(res.status).toBe(308)
      expect(res.headers.get('location')).toBe(to)
    }
  })

  it('/admin/prospects and /admin/pipeline (old admin emails linked them)', async () => {
    for (const mod of [await import('@/app/admin/prospects/[[...path]]/route'), await import('@/app/admin/pipeline/route')]) {
      const res = await (mod.GET as () => Response)()
      expect(res.status).toBe(308)
      expect(res.headers.get('location')).toBe(LIST)
    }
  })

  it('the members link on /u/<memberSlug> still lands on that client', () => {
    expect(read('app/u/[memberSlug]/page.tsx')).toContain('href={`/admin/clients/${tenant.id}/members`}')
  })
})

describe('what was deleted stays deleted', () => {
  it('no checklist, no prospect or pipeline pages, no client admin pages', () => {
    for (const p of [
      'app/admin/clients/[id]/OnboardingChecklist.tsx',
      'app/admin/clients/[id]/page.tsx',
      'app/admin/clients/page.tsx',
      'app/admin/clients/new/page.tsx',
      'app/admin/prospects/page.tsx',
      'app/admin/prospects/[id]/page.tsx',
      'app/admin/pipeline/page.tsx',
      'app/api/admin/pipeline',
      'app/api/admin/prospect-chat',
    ]) {
      expect(existsSync(path.join(root, p)), p).toBe(false)
    }
  })

  it('reps.onboarding_steps is no longer written', () => {
    expect(read('lib/admin-db.ts')).not.toContain('onboarding_steps:')
    expect(read('lib/admin-db.ts')).not.toContain('setOnboardingStep')
    expect(read('lib/onboarding.ts')).not.toContain('defaultOnboardingSteps')
  })
})

describe('what stays', () => {
  it('the admin nav is CFO, Stack, Errors and one link to Accounts', () => {
    const nav = read('app/admin/AdminNav.tsx')
    for (const href of ['/admin/cfo', '/admin/stack', '/admin/errors']) expect(nav).toContain(`href: '${href}'`)
    expect(nav).toContain("'Onboarding → Accounts'")
    expect(nav).toContain('accountsOnboardingUrl()')
    for (const gone of ["'Clients'", "'Prospects'", "'Billing'", '/admin/prospects', '/admin/clients']) expect(nav).not.toContain(gone)
  })

  it('/admin and the admin login land on CFO, not a retired page', () => {
    expect(read('app/admin/page.tsx')).toContain("redirect('/admin/cfo')")
    expect(read('app/admin/login/page.tsx')).toContain("redirect('/admin/cfo')")
  })

  it('/admin/billing still resolves, and the store app still treats it as a purchase page', () => {
    expect(existsSync(path.join(root, 'app/admin/billing/page.tsx'))).toBe(true)
    expect(isPurchaseHref('/admin/billing')).toBe(true)
  })

  it('the kept admin pages and the client sign link are still there', () => {
    for (const p of ['app/admin/login/page.tsx', 'app/admin/cfo/page.tsx', 'app/admin/stack/page.tsx', 'app/admin/errors/page.tsx', 'app/onboard/[token]/page.tsx']) {
      expect(existsSync(path.join(root, p)), p).toBe(true)
    }
    expect(read('middleware.ts')).toMatch(/'\/admin',\s+\/\/ admin has its own password gate/)
  })
})
