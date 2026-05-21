/**
 * Brain dump route layout — see comment on /dashboard/layout.tsx.
 * Same `[data-app-shell]` marker so the brain dump page picks up the
 * paper background + lighter card styling that the rest of the app uses,
 * and the same collapsible left-sidebar shell.
 */
import DashboardShell from '@/app/components/DashboardShell'
import { buildDashboardTabs, type DashboardNavData } from '@/app/dashboard/dashboardTabs'
import type { BrandKey } from '@/lib/brand'

export default async function BrainLayout({ children }: { children: React.ReactNode }) {
  let nav: DashboardNavData | null = null
  let brand: BrandKey | undefined
  try {
    const { requireMember } = await import('@/lib/tenant')
    const ctx = await requireMember()
    brand = ctx.tenant.brand
    nav = await buildDashboardTabs(ctx.tenant.id, ctx.member)
  } catch {
    // No member context — child page's own auth handles redirect.
  }

  return (
    <>
      <div data-app-shell hidden aria-hidden />
      <DashboardShell tabs={nav?.tabs ?? []} lockedAddons={nav?.lockedAddons ?? []} brandKey={brand}>
        {children}
      </DashboardShell>
    </>
  )
}
