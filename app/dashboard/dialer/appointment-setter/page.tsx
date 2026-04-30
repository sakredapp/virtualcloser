import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import DashboardNav from '@/app/dashboard/DashboardNav'
import { supabase } from '@/lib/supabase'
import { listSalespeople } from '@/lib/ai-salesperson'
import { resolveMemberDataScope } from '@/lib/permissions'
import ModePillNav from '../ModePillNav'
import SalespeopleListClient, { type SalespersonCard } from './SalespeopleListClient'

export const dynamic = 'force-dynamic'

export default async function AppointmentSetterPage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  if (host.startsWith('www.') || host === 'virtualcloser.com') redirect('/login')

  let tenant
  let viewerMember: Awaited<ReturnType<typeof requireMember>>['member'] | null = null
  try {
    const ctx = await requireMember()
    tenant = ctx.tenant
    viewerMember = ctx.member
  } catch {
    redirect('/login')
  }

  const navTabs = await buildDashboardTabs(tenant!.id, viewerMember)

  // For enterprise accounts, scope the list to setters assigned to this member's team.
  let memberIds: string[] | null = null
  if (tenant.tier === 'enterprise' && viewerMember) {
    const scope = await resolveMemberDataScope(viewerMember)
    memberIds = scope.memberIds
  }

  const setters = await listSalespeople(tenant.id, { includeArchived: true, memberIds })

  // Today range for per-setter stats.
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const startIso = dayStart.toISOString()

  const setterIds = setters.map((s) => s.id)

  // Aggregate today's dials + confirmations + total leads per setter.
  const [callsRes, leadsRes] = await Promise.all([
    setterIds.length
      ? supabase
          .from('voice_calls')
          .select('ai_salesperson_id, outcome, created_at')
          .eq('rep_id', tenant.id)
          .in('ai_salesperson_id', setterIds)
          .gte('created_at', startIso)
      : Promise.resolve({ data: [] as Array<{ ai_salesperson_id: string | null; outcome: string | null }> }),
    setterIds.length
      ? supabase
          .from('leads')
          .select('ai_salesperson_id')
          .eq('rep_id', tenant.id)
          .in('ai_salesperson_id', setterIds)
      : Promise.resolve({ data: [] as Array<{ ai_salesperson_id: string | null }> }),
  ])

  const dialsBySetter = new Map<string, number>()
  const apptsBySetter = new Map<string, number>()
  for (const row of callsRes.data ?? []) {
    const id = row.ai_salesperson_id
    if (!id) continue
    dialsBySetter.set(id, (dialsBySetter.get(id) ?? 0) + 1)
    if (row.outcome === 'confirmed') {
      apptsBySetter.set(id, (apptsBySetter.get(id) ?? 0) + 1)
    }
  }

  const leadsBySetter = new Map<string, number>()
  for (const row of leadsRes.data ?? []) {
    const id = row.ai_salesperson_id
    if (!id) continue
    leadsBySetter.set(id, (leadsBySetter.get(id) ?? 0) + 1)
  }

  const cards: SalespersonCard[] = setters.map((sp) => {
    const sched = (sp.schedule ?? {}) as { leads_per_day?: number; max_calls_per_day?: number }
    const cap = sched.leads_per_day ?? sched.max_calls_per_day ?? 120
    const persona = (sp.voice_persona ?? {}) as { ai_name?: string }
    const product = (sp.product_intent ?? {}) as { name?: string }
    return {
      id: sp.id,
      name: sp.name,
      status: sp.status,
      ai_name: persona.ai_name ?? null,
      product_name: product.name ?? null,
      dials_today: dialsBySetter.get(sp.id) ?? 0,
      appts_today: apptsBySetter.get(sp.id) ?? 0,
      leads_total: leadsBySetter.get(sp.id) ?? 0,
      pacing_cap_per_day: cap,
    }
  })

  return (
    <main className="wrap">
      <header className="hero" style={{ paddingBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Link href="/dashboard/dialer" style={{ color: 'var(--red)', fontSize: 13, textDecoration: 'none' }}>
            ← AI Dialer
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            background: '#dbeafe', color: '#1d4ed8', borderRadius: 8,
            padding: '6px 12px', fontSize: 13, fontWeight: 700,
          }}>
            🤖 AI SDR
          </span>
          <div>
            <h1 style={{ margin: 0 }}>AI SDR</h1>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              Build, train, and run multiple AI SDRs — each with their own product, persona, scripts, schedule, and lead list.
            </p>
          </div>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <ModePillNav active="appointment_setter" />

      <SalespeopleListClient initial={cards} viewerRole={viewerMember?.role} />
    </main>
  )
}
