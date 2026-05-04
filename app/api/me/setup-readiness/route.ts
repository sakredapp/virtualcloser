// Setup readiness checks for each agent mode.
// Returns per-mode checklists so the UI can show green/amber/red status.

import { NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { getDialerSettings } from '@/lib/voice/dialerSettings'
import { listSalespeople } from '@/lib/ai-salesperson'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CheckItem = {
  key: string
  label: string
  ok: boolean
  note: string
  fix_url?: string
}

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const repId = ctx.tenant.id

  const [rrCfg, voicePromptCfg, vapiCfg, dialerSettings, salespeople] = await Promise.all([
    getIntegrationConfig(repId, 'revring'),
    getIntegrationConfig(repId, 'voice_prompts').then((c) =>
      c ?? getIntegrationConfig(repId, 'vapi'),
    ),
    getIntegrationConfig(repId, 'vapi'),
    getDialerSettings(repId),
    listSalespeople(repId, { includeArchived: false }),
  ])

  const hasApiKey = Boolean(rrCfg?.api_key)
  const hasFromNumber = Boolean(rrCfg?.from_number)
  const hasProductSummary = Boolean(
    (voicePromptCfg?.product_summary as string | undefined)?.trim(),
  )
  const liveEnabled = rrCfg?.live_enabled === true || process.env.VOICE_LIVE_ENABLED === 'true'

  // SDR checks
  const activeSdr = salespeople.find((s) => s.status === 'active')
  const hasSchedule = Boolean(activeSdr?.schedule?.active_days?.length)

  const { count: pendingLeadCount } = await supabase
    .from('dialer_queue')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('dialer_mode', 'appointment_setter')
    .eq('status', 'pending')

  const sdrChecks: CheckItem[] = [
    {
      key: 'voice_provider',
      label: 'Voice provider connected',
      ok: hasApiKey,
      note: hasApiKey ? 'Connected' : 'Contact your account manager to activate AI calling',
      fix_url: '/dashboard/integrations',
    },
    {
      key: 'from_number',
      label: 'Outbound phone number',
      ok: hasFromNumber,
      note: hasFromNumber ? String(rrCfg!.from_number) : 'Contact your account manager to assign a number',
      fix_url: '/dashboard/integrations',
    },
    {
      key: 'sdr_agent_id',
      label: 'AI Voice agent configured',
      ok: Boolean(rrCfg?.appointment_setter_agent_id),
      note: Boolean(rrCfg?.appointment_setter_agent_id)
        ? 'Configured'
        : 'Contact your account manager — set up during onboarding',
      fix_url: '/dashboard/integrations',
    },
    {
      key: 'live_enabled',
      label: 'Live calling enabled',
      ok: liveEnabled,
      note: liveEnabled ? 'Live mode active' : 'Contact your account manager to enable live calling',
      fix_url: '/dashboard/integrations',
    },
    {
      key: 'sdr_created',
      label: 'AI SDR created',
      ok: salespeople.length > 0,
      note: salespeople.length > 0 ? `${salespeople.length} SDR(s) configured` : 'Create your first AI SDR',
      fix_url: '/dashboard/dialer/appointment-setter',
    },
    {
      key: 'sdr_active',
      label: 'At least one SDR active',
      ok: Boolean(activeSdr),
      note: activeSdr ? `"${activeSdr.name}" is active` : 'Enable an SDR to start dialing',
      fix_url: '/dashboard/dialer/appointment-setter',
    },
    {
      key: 'sdr_schedule',
      label: 'Work schedule set',
      ok: hasSchedule,
      note: hasSchedule ? 'Schedule configured' : 'Set active days + hours on your SDR',
      fix_url: '/dashboard/dialer/appointment-setter',
    },
    {
      key: 'leads_loaded',
      label: 'Leads in queue',
      ok: (pendingLeadCount ?? 0) > 0,
      note:
        (pendingLeadCount ?? 0) > 0
          ? `${pendingLeadCount} pending leads`
          : 'Import a lead list to start dialing',
      fix_url: '/dashboard/dialer/appointment-setter',
    },
  ]

  // Receptionist checks
  const { count: meetingCount } = await supabase
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .gte('scheduled_at', new Date().toISOString())
    .lte('scheduled_at', new Date(Date.now() + 7 * 86400_000).toISOString())

  const receptionistChecks: CheckItem[] = [
    {
      key: 'voice_provider',
      label: 'Voice provider connected',
      ok: hasApiKey,
      note: hasApiKey ? 'Connected' : 'Contact your account manager to activate AI calling',
      fix_url: '/dashboard/integrations',
    },
    {
      key: 'confirm_agent_id',
      label: 'Receptionist agent configured',
      ok: Boolean(rrCfg?.confirm_agent_id),
      note: Boolean(rrCfg?.confirm_agent_id) ? 'Configured' : 'Contact your account manager — set up during onboarding',
      fix_url: '/dashboard/integrations',
    },
    {
      key: 'auto_confirm_enabled',
      label: 'Auto-confirm enabled',
      ok: dialerSettings.auto_confirm_enabled,
      note: dialerSettings.auto_confirm_enabled ? 'On — cron will auto-dial' : 'Enable auto-confirm in Receptionist settings',
      fix_url: '/dashboard/dialer/receptionist',
    },
    {
      key: 'live_enabled',
      label: 'Live calling enabled',
      ok: liveEnabled,
      note: liveEnabled ? 'Live mode active' : 'Contact your account manager to enable live calling',
      fix_url: '/dashboard/integrations',
    },
    {
      key: 'upcoming_meetings',
      label: 'Meetings on calendar',
      ok: (meetingCount ?? 0) > 0,
      note:
        (meetingCount ?? 0) > 0
          ? `${meetingCount} meeting(s) in next 7 days`
          : 'Connect your calendar so meetings sync (Settings → Integrations)',
      fix_url: '/dashboard/integrations',
    },
    {
      key: 'product_summary',
      label: 'Product summary written',
      ok: hasProductSummary,
      note: hasProductSummary ? 'Prompt set' : 'Write a product summary in Prompt Settings',
      fix_url: '/dashboard/dialer/receptionist',
    },
  ]

  // Trainer / Roleplay checks
  const { count: docsCount } = await supabase
    .from('training_docs')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('is_active', true)

  const scenariosRes = await supabase
    .from('roleplay_scenarios')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('is_active', true)
  const scenariosCount = scenariosRes.count ?? 0

  const trainerChecks: CheckItem[] = [
    {
      key: 'voice_provider',
      label: 'Voice provider connected',
      ok: hasApiKey,
      note: hasApiKey ? 'Connected' : 'Contact your account manager to activate AI calling',
      fix_url: '/dashboard/integrations',
    },
    {
      key: 'product_summary',
      label: 'Product summary written',
      ok: hasProductSummary,
      note: hasProductSummary ? 'Prompt set' : 'Write a product summary so the AI knows your offer',
      fix_url: '/dashboard/roleplay',
    },
    {
      key: 'training_docs',
      label: 'Training docs uploaded',
      ok: (docsCount ?? 0) > 0,
      note:
        (docsCount ?? 0) > 0
          ? `${docsCount} active document(s)`
          : 'Upload scripts, objection lists, or product briefs',
      fix_url: '/dashboard/roleplay',
    },
    {
      key: 'scenarios',
      label: 'Roleplay scenarios created',
      ok: (scenariosCount ?? 0) > 0,
      note:
        (scenariosCount ?? 0) > 0
          ? `${scenariosCount} scenario(s) ready`
          : 'Create at least one scenario to start practice calls',
      fix_url: '/dashboard/roleplay',
    },
  ]

  return NextResponse.json({
    ok: true,
    checks: {
      sdr: sdrChecks,
      receptionist: receptionistChecks,
      trainer: trainerChecks,
    },
  })
}
