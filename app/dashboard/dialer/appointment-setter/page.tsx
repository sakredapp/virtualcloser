import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import DashboardNav from '@/app/dashboard/DashboardNav'
import { supabase } from '@/lib/supabase'
import { getIntegrationConfig } from '@/lib/client-integrations'
import AppointmentSetterClient from './AppointmentSetterClient'
import type { AppointmentSetterConfig } from '@/app/api/me/appointment-setter-config/route'
import { DEFAULT_APPT_SETTER_CONFIG } from '@/app/api/me/appointment-setter-config/route'
import ModePillNav from '../ModePillNav'
import VoicePromptEditor from '@/app/dashboard/VoicePromptEditor'
import TrainingDocsManager from '@/app/dashboard/TrainingDocsManager'

export const dynamic = 'force-dynamic'

export default async function AppointmentSetterPage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  if (host.startsWith('www.') || host === 'virtualcloser.com') redirect('/login')

  let tenant
  let memberRole = 'rep'
  let viewerMember: Awaited<ReturnType<typeof requireMember>>['member'] | null = null
  try {
    const ctx = await requireMember()
    tenant = ctx.tenant
    memberRole = (ctx.member.role as string) ?? 'rep'
    viewerMember = ctx.member
  } catch {
    redirect('/login')
  }

  void memberRole

  const navTabs = await buildDashboardTabs(tenant!.id, viewerMember)

  const [stored, queueRows, vapiCfg] = await Promise.all([
    getIntegrationConfig(tenant.id, 'appointment_setter_config'),
    supabase
      .from('dialer_queue')
      .select('status, last_outcome')
      .eq('rep_id', tenant.id)
      .eq('dialer_mode', 'appointment_setter'),
    getIntegrationConfig(tenant.id, 'vapi'),
  ])

  const config: AppointmentSetterConfig = { ...DEFAULT_APPT_SETTER_CONFIG, ...(stored ?? {}) }

  const rows = queueRows.data ?? []
  const counts = {
    pending:          rows.filter((r) => r.status === 'pending').length,
    in_progress:      rows.filter((r) => r.status === 'in_progress').length,
    completed:        rows.filter((r) => r.status === 'completed').length,
    failed:           rows.filter((r) => r.status === 'failed').length,
    cancelled:        rows.filter((r) => r.status === 'cancelled').length,
    appointments_set: rows.filter((r) => r.last_outcome === 'confirmed').length,
  }

  const promptInitial = {
    product_summary: (vapiCfg?.product_summary as string) ?? '',
    objections: (vapiCfg?.objections as string) ?? '',
    confirm_addendum: (vapiCfg?.confirm_addendum as string) ?? '',
    reschedule_addendum: (vapiCfg?.reschedule_addendum as string) ?? '',
    roleplay_addendum: (vapiCfg?.roleplay_addendum as string) ?? '',
    ai_name: (vapiCfg?.ai_name as string) ?? '',
  }

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
            📞 Appointment Setter
          </span>
          <div>
            <h1 style={{ margin: 0 }}>Appointment Setter</h1>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              Import leads in bulk, set a work schedule, and let the AI dial all day — booking appointments on your calendar automatically.
            </p>
          </div>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <ModePillNav active="appointment_setter" />

      <AppointmentSetterClient initial={config} initialCounts={counts} />

      <details open style={{ margin: '0 24px 0.8rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Prompt settings</summary>
        <div style={{ marginTop: 8 }}>
          <VoicePromptEditor kind="dialer" initial={promptInitial} />
        </div>
      </details>

      <details open style={{ margin: '0 24px 1.2rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Scripts and docs (drop PDFs, scripts, objections)</summary>
        <div style={{ marginTop: 8 }}>
          <TrainingDocsManager
            heading="Knowledge base for the appointment setter"
            allowedKinds={['script', 'objection_list', 'product_brief', 'reference']}
            kindFilter={['script', 'objection_list', 'product_brief', 'reference']}
            defaultKind="script"
          />
        </div>
      </details>
    </main>
  )
}
