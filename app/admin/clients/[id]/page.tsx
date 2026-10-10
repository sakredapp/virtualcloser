import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { isAdminAuthed } from '@/lib/admin-auth'
import {
  addClientEvent,
  getClient,
  getClientSummary,
  listClientEvents,
  setOnboardingStep,
  updateClientRow,
} from '@/lib/admin-db'
import { hashPassword } from '@/lib/client-password'
import { TIER_INFO, ADDON_STEPS, fillInstructions, type OnboardingStep } from '@/lib/onboarding'
import { ADDON_CATALOG, HOUR_PACKAGE_KEYS, isHourPackage, formatPriceCents, type AddonKey } from '@/lib/addons'
import { supabase } from '@/lib/supabase'
import { defaultTenantRedirectUri, encryptGoogleSecret, type TenantGoogleOAuthSetting } from '@/lib/google'
import { getBrand } from '@/lib/brand'
import { sendOwnerLoginLink } from '@/lib/onboardingOwner'
import { onboardingUrl as buildOnboardingUrl } from '@/lib/onboardingUrl'
import PendingSubmitButton from '@/app/components/admin/PendingSubmitButton'
import OnboardingLinkPanel from './OnboardingLinkPanel'
import { listClientIntegrations } from '@/lib/client-integrations'
import { getOwnerMember, getSeatUsage, listMembers } from '@/lib/members'
import { resolveActiveHourPackage } from '@/lib/entitlements'
import { listAgreementsForRep, CURRENT_VERSION as LIABILITY_VERSION } from '@/lib/liabilityAgreement'
import ClientIntegrationsManager from './ClientIntegrationsManager'
import OnboardingChecklist from './OnboardingChecklist'
import VoiceInfraCard from './VoiceInfraCard'
import CustomPricingPanel from './CustomPricingPanel'

export const dynamic = 'force-dynamic'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const { id } = await params
  const client = await getClient(id)
  if (!client) notFound()

  const [
    summary,
    events,
    clientIntegrations,
    clientAddonsResult,
    seatUsage,
    activeHourPackage,
    liabilityAgreements,
    clientMembers,
    pricingOverridesResult,
    activeOnboardingToken,
  ] = await Promise.all([
    getClientSummary(client.id),
    listClientEvents(client.id, 20),
    listClientIntegrations(client.id),
    supabase
      .from('client_addons')
      .select('*')
      .eq('rep_id', client.id)
      .order('activated_at', { ascending: true }),
    getSeatUsage(client.id),
    resolveActiveHourPackage(client.id),
    listAgreementsForRep(client.id),
    listMembers(client.id, { includeAssistants: true }),
    supabase.from('reps').select('pricing_overrides').eq('id', client.id).maybeSingle(),
    supabase
      .from('onboarding_tokens')
      .select('token, build_fee_cents, signed_at, paid_at, welcome_sent_at, expires_at, created_at')
      .eq('rep_id', client.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  const pricingOverrides = (pricingOverridesResult.data?.pricing_overrides as {
    monthly_flat_cents?: number
    sdr_hourly_cents?: number
  } | null) ?? {}

  // Campaign setup — health insurance agent + local presence pool
  const [hiAgentResult, localPresenceCountResult] = await Promise.all([
    supabase
      .from('ai_salespeople')
      .select('id, name, status')
      .eq('rep_id', client.id)
      .eq('product_category', 'health_insurance')
      .maybeSingle(),
    supabase
      .from('local_presence_numbers')
      .select('*', { count: 'exact', head: true })
      .eq('rep_id', client.id),
  ])
  const healthInsuranceAgent = hiAgentResult.data as { id: string; name: string; status: string } | null
  const localPresenceCount = localPresenceCountResult.count ?? 0
  const memberById = new Map(clientMembers.map((m) => [m.id, m]))
  const clientAddons = (clientAddonsResult.data ?? []) as {
    id: string
    addon_key: AddonKey
    status: 'active' | 'paused' | 'over_cap' | 'cancelled'
    monthly_price_cents: number
    cap_value: number | null
    cap_unit: string
    source: string
    locked_price_until: string | null
    activated_at: string
    metadata: Record<string, unknown> | null
  }[]
  // Pull the active SDR row + its overrides so the Plan & Limits card can
  // pre-fill the override inputs with the current values.
  const sdrAddonRow = activeHourPackage
    ? clientAddons.find((a) => a.addon_key === activeHourPackage) ?? null
    : null
  const sdrMeta = (sdrAddonRow?.metadata ?? {}) as Record<string, unknown>
  const currentHoursOverride = (sdrMeta.hours_per_week_override as number | undefined) ?? null
  const currentRateOverride =
    typeof sdrMeta.unit_price_cents_override === 'number'
      ? (sdrMeta.unit_price_cents_override as number) / 100
      : null

  // Detect what AI products this client purchased from their pending_plan metadata.
  type PendingPlan = {
    weekly_hours?: number
    trainer_weekly_hours?: number
    metadata?: {
      sdr_included?: boolean
      trainer_included?: boolean
      receptionist_included?: boolean
      sdr_hours_per_week?: number
      trainer_hours_per_week?: number
    }
  }
  const pendingPlan = ((client as unknown as Record<string, unknown>).pending_plan as PendingPlan | null)
  const planMeta = pendingPlan?.metadata ?? {}
  const hasSdr = planMeta.sdr_included === true || (pendingPlan?.weekly_hours ?? 0) > 0
  const hasTrainer = planMeta.trainer_included === true || (pendingPlan?.trainer_weekly_hours ?? 0) > 0
  const hasReceptionist = planMeta.receptionist_included === true

  const steps = (client.onboarding_steps ?? []) as OnboardingStep[]

  // Inject any product setup steps that are missing from stored onboarding_steps.
  // This handles clients whose steps were seeded before these product steps existed,
  // or who came through the offer page (where SDR/Trainer aren't addon keys).
  const storedStepKeys = new Set(steps.map((s) => s.key))
  const injectedSteps: OnboardingStep[] = []
  if (hasSdr && !storedStepKeys.has('addon_ai_dialer_20h') && ADDON_STEPS['addon_ai_dialer_20h']) {
    injectedSteps.push({ ...ADDON_STEPS['addon_ai_dialer_20h']!, done: false, done_at: null })
  }
  if (hasTrainer && !storedStepKeys.has('addon_ai_trainer_5h') && ADDON_STEPS['addon_ai_trainer_5h']) {
    injectedSteps.push({ ...ADDON_STEPS['addon_ai_trainer_5h']!, done: false, done_at: null })
  }
  if (hasReceptionist && !storedStepKeys.has('addon_ai_receptionist') && ADDON_STEPS['addon_ai_receptionist']) {
    injectedSteps.push({ ...ADDON_STEPS['addon_ai_receptionist']!, done: false, done_at: null })
  }
  const allSteps = [...steps, ...injectedSteps]

  const doneCount = allSteps.filter((s) => s.done).length
  const pct = Math.round((doneCount / Math.max(allSteps.length, 1)) * 100)
  const info = TIER_INFO[client.tier] ?? TIER_INFO.individual
  const nextStep = allSteps.find((s) => !s.done) ?? null

  // ── Admin launch sequence — computed from live data ──────────────────────
  // These are the ordered admin tasks to complete before the client can use
  // the platform. Shown prominently at the top of the detail page.
  const rrCfg = clientIntegrations.find((i) => i.key === 'revring')?.config ?? null
  const twilioCfg = clientIntegrations.find((i) => i.key === 'twilio')?.config ?? null
  type LaunchStep = { key: string; label: string; hint: string; done: boolean; owner: 'admin' | 'client' }
  const launchSequence: LaunchStep[] = [
    {
      key: 'welcome_email',
      label: 'Send welcome email',
      hint: `Set a login email below and click "Send login link" — the owner gets a "Your login is ready" email with a link to set their own password. No password is emailed.`,
      done: !!(client.email && steps.find((s) => s.key === 'set_client_login')?.done),
      owner: 'admin',
    },
    {
      key: 'twilio_subaccount',
      label: `Provision Twilio sub-account${twilioCfg?.provisioned_by_platform ? ` (${String(twilioCfg.account_sid ?? '').slice(0, 12)}…)` : ''}`,
      hint: 'Required by Twilio ToS for reselling. Click "Provision Twilio sub-account" in Voice & SMS Infrastructure below.',
      done: !!(twilioCfg?.account_sid),
      owner: 'admin',
    },
    {
      key: 'voice_model',
      label: `Voice billing model: ${rrCfg?.voice_billing_model ? String(rrCfg.voice_billing_model) : 'not set'}`,
      hint: client.tier === 'enterprise'
        ? 'Enterprise: choose "own trunk" (their RevRing account) or "platform trunk" (we provision one). Set in Voice & SMS Infrastructure below.'
        : 'Individual: leave as "shared" — platform RevRing account is used automatically. Confirm in Voice & SMS Infrastructure below.',
      done: !!(rrCfg?.voice_billing_model) || client.tier !== 'enterprise',
      owner: 'admin',
    },
    {
      key: 'agent_ids',
      label: 'Configure AI agent IDs',
      hint: 'Create the AI voice agents in the RevRing dashboard, then paste the IDs into the AI Voice card in Client Integrations below.',
      done: !!(rrCfg?.confirm_agent_id || rrCfg?.appointment_setter_agent_id || rrCfg?.pipeline_agent_id),
      owner: 'admin',
    },
    {
      key: 'billing_activate',
      label: `Activate billing subscription${(client as unknown as Record<string,unknown>).billing_status === 'active' ? ' (active)' : ''}`,
      hint: 'POST /api/admin/billing/[id]/activate-subscription — or use the Stripe billing panel. Seeds agent_billing rows so canDial() unblocks.',
      done: (client as unknown as Record<string,unknown>).billing_status === 'active',
      owner: 'admin',
    },
    {
      key: 'agreement_signed',
      label: 'Client signs liability agreement',
      hint: 'Client signs automatically on first login to their portal. Check the "AI Dialer Liability Agreements" section below.',
      done: liabilityAgreements.length > 0,
      owner: 'client',
    },
    {
      key: 'training_docs',
      label: 'Client uploads training docs',
      hint: 'Direct them to /dashboard/dialer or /dashboard/roleplay → drag-drop their product brief, scripts, and objection guides.',
      done: summary.runs > 0 || steps.find((s) => s.key === 'upload_training_docs')?.done === true,
      owner: 'client',
    },
    {
      key: 'test_call',
      label: 'Test live call end-to-end',
      hint: 'Upload one lead, set dry_run=false + live_enabled=true in AI Voice config, trigger a call from the dialer. Confirm it connects and AI speaks.',
      done: steps.find((s) => s.key === 'test_live_call')?.done === true,
      owner: 'admin',
    },
  ]
  const adminLaunchDone = launchSequence.filter((s) => s.owner === 'admin' && s.done).length
  const adminLaunchTotal = launchSequence.filter((s) => s.owner === 'admin').length
  const launchComplete = launchSequence.every((s) => s.done)

  async function toggleStep(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const key = String(formData.get('key') ?? '')
    const done = formData.get('done') === '1'
    await setOnboardingStep(id, key, done)
    await addClientEvent({
      repId: id,
      kind: 'onboarding_step',
      title: `${done ? 'Completed' : 'Reopened'}: ${key}`,
    })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function addNote(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const body = String(formData.get('body') ?? '').trim()
    if (!body) return
    await addClientEvent({ repId: id, kind: 'note', title: 'Note', body })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function saveIntegrations(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const patch: Partial<NonNullable<typeof client>> = {
      claude_api_key: String(formData.get('claude_api_key') ?? '') || null,
      build_notes: String(formData.get('build_notes') ?? '') || null,
    }
    await updateClientRow(id, patch)
    await addClientEvent({ repId: id, kind: 'integration', title: 'Integrations updated' })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function saveLoginDetails(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const email = String(formData.get('email') ?? '').trim().toLowerCase() || null
    const password = String(formData.get('password') ?? '')
    const sendLink = formData.get('send_login_link') === '1'
    const patch: Record<string, unknown> = { email }
    let hash: string | null = null
    if (password && password.length >= 8) {
      hash = await hashPassword(password)
      patch.password_hash = hash
    }
    await updateClientRow(id, patch as Partial<NonNullable<typeof client>>)
    // Login checks the member's own password first, so the owner member must
    // get the same hash or the new password never works for them.
    if (hash) {
      const owner = await getOwnerMember(id)
      if (owner) {
        const { error } = await supabase
          .from('members')
          .update({ password_hash: hash, password_reset_token: null, password_reset_expires_at: null })
          .eq('id', owner.id)
        if (error) throw error
      }
    }
    await addClientEvent({
      repId: id,
      kind: 'billing',
      title: password ? 'Login credentials updated (email + password)' : 'Login email updated',
    })

    // Never email the password: the owner gets the set-your-password link.
    if (sendLink && email) await sendOwnerLoginLink(id, 'admin save login')

    revalidatePath(`/admin/clients/${id}`)
  }

  // One-click onboarding: email the owner member "Your login is ready" with a
  // set-your-password link (re-used if 1+ day left, else fresh for 7 days).
  // No plaintext password, no Telegram. A second click inside 2 minutes is
  // refused server-side and logged as "skipped duplicate".
  async function oneClickLoginLink(_formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    await sendOwnerLoginLink(id)
    revalidatePath(`/admin/clients/${id}`)
  }

  async function toggleAddonStatus(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const addonId = String(formData.get('addon_id') ?? '')
    const newStatus = String(formData.get('status') ?? '')
    if (!addonId || !['active', 'paused', 'cancelled'].includes(newStatus)) return
    await supabase
      .from('client_addons')
      .update({ status: newStatus, paused_at: newStatus === 'paused' ? new Date().toISOString() : null })
      .eq('id', addonId)
      .eq('rep_id', id)
    await addClientEvent({ repId: id, kind: 'billing', title: `Addon status → ${newStatus}: ${addonId}` })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function setSdrConfig(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')

    const hoursRaw = String(formData.get('sdr_hours_per_week') ?? '').trim()
    const rateRaw = String(formData.get('sdr_dollar_per_hour') ?? '').trim()
    const hours = hoursRaw === '' ? 0 : Math.max(0, Math.min(168, Math.floor(Number(hoursRaw))))
    const rate = rateRaw === '' ? 6 : Math.max(0.5, Math.min(50, Number(rateRaw)))

    await supabase
      .from('client_addons')
      .delete()
      .eq('rep_id', id)
      .in('addon_key', HOUR_PACKAGE_KEYS as unknown as string[])

    if (!hours) {
      await addClientEvent({ repId: id, kind: 'billing', title: 'SDR plan removed' })
      revalidatePath(`/admin/clients/${id}`)
      return
    }

    const monthlyCents = Math.round(hours * 4.3 * rate * 100)
    await supabase.from('client_addons').upsert(
      {
        rep_id: id,
        addon_key: 'addon_ai_dialer_20h',
        status: 'active',
        monthly_price_cents: monthlyCents,
        cap_value: hours,
        cap_unit: 'hours_per_week',
        source: 'admin_config',
        metadata: {
          hours_per_week_override: hours,
          unit_price_cents_override: Math.round(rate * 100),
        },
      },
      { onConflict: 'rep_id,addon_key' },
    )
    await addClientEvent({
      repId: id,
      kind: 'billing',
      title: `SDR configured: ${hours} hrs/wk × $${rate.toFixed(2)}/hr = $${(monthlyCents / 100).toFixed(0)}/mo`,
    })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function saveTenantLimits(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const raw = String(formData.get('max_seats') ?? '').trim()
    let maxSeats: number | null = null
    if (raw !== '') {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0 || n > 10000) return
      maxSeats = Math.floor(n)
    }
    await updateClientRow(id, { max_seats: maxSeats } as Partial<NonNullable<typeof client>>)
    await addClientEvent({
      repId: id,
      kind: 'billing',
      title: maxSeats === null ? 'Seat cap removed (unlimited)' : `Seat cap set → ${maxSeats}`,
    })
    revalidatePath(`/admin/clients/${id}`)
  }

  // Google OAuth client per tenant (owner 10-10): a customer can bring its own
  // Google client (created inside their Workspace, user type Internal). The
  // secret is encrypted before it is stored; blank fields keep what is saved.
  async function saveGoogleOAuth(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const { data: row } = await supabase.from('reps').select('settings').eq('id', id).maybeSingle()
    const settings = { ...(((row as { settings?: Record<string, unknown> | null } | null)?.settings) ?? {}) }
    if (formData.get('clear') === '1') {
      delete settings.google_oauth
      await supabase.from('reps').update({ settings }).eq('id', id)
      await addClientEvent({ repId: id, kind: 'integration', title: 'Own Google OAuth client removed (back to the global client)' })
      revalidatePath(`/admin/clients/${id}`)
      return
    }
    const prev = (settings.google_oauth ?? {}) as TenantGoogleOAuthSetting
    const clientId = String(formData.get('google_client_id') ?? '').trim()
    const secret = String(formData.get('google_client_secret') ?? '').trim()
    const redirectUri = String(formData.get('google_redirect_uri') ?? '').trim()
    if (clientId && !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(clientId)) return
    if (redirectUri && !/^https:\/\/[a-z0-9.-]+\/api\/google\/oauth\/callback$/i.test(redirectUri)) return
    const next: TenantGoogleOAuthSetting = { ...prev, updated_at: new Date().toISOString() }
    if (clientId) next.client_id = clientId
    if (secret) {
      const enc = encryptGoogleSecret(secret)
      if (!enc) return // no encryption key configured: never store the secret in plain text
      next.client_secret_enc = enc
    }
    if (redirectUri) next.redirect_uri = redirectUri
    else delete next.redirect_uri
    settings.google_oauth = next
    await supabase.from('reps').update({ settings }).eq('id', id)
    await addClientEvent({ repId: id, kind: 'integration', title: 'Own Google OAuth client saved' })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function saveFurnaceConfig(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const enabled = formData.get('furnace_enabled') === '1'
    const clientIdRaw = String(formData.get('furnace_client_id') ?? '').trim()
    const { data: current } = await supabase.from('reps').select('settings').eq('id', id).maybeSingle()
    const existingSettings = (current?.settings as Record<string, unknown> | null) ?? {}
    const furnaceSettings = enabled
      ? { enabled: true, client_id: clientIdRaw || undefined }
      : { enabled: false }
    await supabase.from('reps').update({
      settings: { ...existingSettings, furnace: furnaceSettings },
    }).eq('id', id)
    await addClientEvent({
      repId: id,
      kind: 'integration',
      title: enabled ? `Furnace client enabled${clientIdRaw ? ` (client_id: ${clientIdRaw})` : ''}` : 'Furnace client disabled',
    })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function addAddon(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const addonKey = String(formData.get('addon_key') ?? '') as AddonKey
    if (!addonKey || !(addonKey in ADDON_CATALOG)) return
    const def = ADDON_CATALOG[addonKey]
    await supabase
      .from('client_addons')
      .upsert({
        rep_id: id,
        addon_key: addonKey,
        status: 'active',
        monthly_price_cents: def.monthly_price_cents,
        cap_value: def.cap_value,
        cap_unit: def.cap_unit,
        source: 'admin_cart',
      }, { onConflict: 'rep_id,addon_key' })
    await addClientEvent({ repId: id, kind: 'billing', title: `Addon added: ${def.label}` })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function provisionHealthInsuranceAgent(_fd: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const { data: existing } = await supabase
      .from('ai_salespeople')
      .select('id')
      .eq('rep_id', id)
      .eq('product_category', 'health_insurance')
      .maybeSingle()
    if (existing?.id) {
      revalidatePath(`/admin/clients/${id}`)
      return
    }
    const { HEALTH_INSURANCE_TEMPLATE } = await import('@/lib/voice/healthInsuranceAgent')
    const { randomUUID } = await import('node:crypto')
    await supabase.from('ai_salespeople').insert({
      id: randomUUID(),
      rep_id: id,
      ...HEALTH_INSURANCE_TEMPLATE,
      status: 'active',
    })
    await addClientEvent({ repId: id, kind: 'integration', title: 'Provisioned Health Insurance AI Agent (Rachel)' })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function importLocalPresenceNumbers(fd: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const raw = String(fd.get('numbers') ?? '').trim()
    if (!raw) return
    const lines = raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
    if (lines.length === 0) return
    const { importLocalNumbers } = await import('@/lib/campaign/localPresence')
    const result = await importLocalNumbers(id, lines.map((e164) => ({ e164 })))
    await addClientEvent({
      repId: id,
      kind: 'integration',
      title: `Local presence: imported ${result.imported} numbers, skipped ${result.skipped} duplicates`,
    })
    revalidatePath(`/admin/clients/${id}`)
  }

  const furnaceCfg = ((client as unknown as Record<string, unknown>).settings as Record<string, unknown> | null)?.furnace as { enabled?: boolean; client_id?: string } | undefined
  const isFurnaceClient = furnaceCfg?.enabled === true

  const onboardToken = activeOnboardingToken.data as {
    token: string
    build_fee_cents: number
    signed_at: string | null
    paid_at: string | null
    welcome_sent_at: string | null
    expires_at: string
    created_at: string
  } | null

  // The tenant's own brand domain (suitecxo.com for CXO), never ROOT_DOMAIN.
  const brandCfg = getBrand((client as { brand?: string | null }).brand)
  const onboardUrl = onboardToken ? buildOnboardingUrl(brandCfg.key, onboardToken.token) : null
  const onboardExpired = onboardToken ? new Date(onboardToken.expires_at) < new Date() : false

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Client</p>
        <h1>{client.display_name}</h1>
        <p className="sub">
          {client.slug}.{brandCfg.rootDomain} · {info.label} · ${client.monthly_fee}/mo · build ${client.build_fee}
        </p>
        <p className="nav">
          <Link href="/admin/clients">← All clients</Link>
          <span>·</span>
          <Link href={`/admin/clients/${client.id}/members`}>Members & teams</Link>
          <span>·</span>
          <Link href={`/admin/clients/${client.id}/cost`}>Cost analytics</Link>
          <span>·</span>
          <a href={`/api/admin/impersonate?rep_id=${client.id}`} target="_blank" rel="noreferrer">View client portal ↗</a>
          <span>·</span>
          <Link href="/offer">Offer page</Link>
        </p>
      </header>

      {/* Products purchased — quick-glance for whoever is doing the build */}
      {(hasSdr || hasTrainer || hasReceptionist) && (
        <section style={{
          marginTop: '0.6rem',
          padding: '12px 16px',
          background: '#0b1f5c',
          borderRadius: 10,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#93c5fd', marginRight: 4 }}>
            Products purchased:
          </span>
          {hasSdr && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 6, background: 'var(--red, #ff2800)', color: '#fff' }}>
              AI SDR · {planMeta.sdr_hours_per_week ?? pendingPlan?.weekly_hours ?? '?'} hrs/wk
            </span>
          )}
          {hasTrainer && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 6, background: '#7c3aed', color: '#fff' }}>
              AI Trainer · {planMeta.trainer_hours_per_week ?? pendingPlan?.trainer_weekly_hours ?? '?'} hrs/wk
            </span>
          )}
          {hasReceptionist && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 6, background: '#0891b2', color: '#fff' }}>
              AI Receptionist
            </span>
          )}
          {injectedSteps.length > 0 && (
            <span style={{ fontSize: 11, color: '#fbbf24', marginLeft: 'auto' }}>
              ⚠ {injectedSteps.length} setup step{injectedSteps.length > 1 ? 's' : ''} added from plan (not yet in stored steps)
            </span>
          )}
        </section>
      )}

      <section className="grid-4">
        <article className="card stat">
          <p className="label">Leads</p>
          <p className="value">{summary.leads}</p>
        </article>
        <article className="card stat">
          <p className="label">Pending drafts</p>
          <p className="value">{summary.drafts}</p>
        </article>
        <article className="card stat">
          <p className="label">Agent runs</p>
          <p className="value">{summary.runs}</p>
        </article>
        <article className="card stat">
          <p className="label">Onboarding</p>
          <p className="value">{pct}%</p>
          <p className="hint">{doneCount} / {allSteps.length} steps</p>
        </article>
      </section>

      {/* ── Admin launch sequence ── */}
      {!launchComplete && (
        <section className="card" style={{ marginTop: '0.8rem', borderLeft: '4px solid #0b1f5c' }}>
          <div className="section-head">
            <h2>Admin setup sequence</h2>
            <p style={{ color: adminLaunchDone === adminLaunchTotal ? '#1f8a3b' : '#92400e' }}>
              {adminLaunchDone}/{adminLaunchTotal} admin tasks done
            </p>
          </div>
          <div style={{ display: 'grid', gap: 0 }}>
            {(['admin', 'client'] as const).map((owner) => {
              const ownerSteps = launchSequence.filter((s) => s.owner === owner)
              return (
                <div key={owner} style={{ marginBottom: 14 }}>
                  <p style={{
                    fontSize: 10,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: owner === 'admin' ? '#0b1f5c' : '#6b7280',
                    margin: '0 0 8px',
                  }}>
                    {owner === 'admin' ? '→ You do (admin)' : '→ Client does (after you\'re done)'}
                  </p>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {ownerSteps.map((s, idx) => (
                      <div
                        key={s.key}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'flex-start',
                          padding: '8px 10px',
                          borderRadius: 7,
                          background: s.done ? '#f0fdf4' : '#f9fafb',
                          border: `1px solid ${s.done ? '#bbf7d0' : '#e5e7eb'}`,
                          opacity: s.done ? 0.75 : 1,
                        }}
                      >
                        <span style={{
                          fontWeight: 800,
                          fontSize: 13,
                          color: s.done ? '#16a34a' : '#9ca3af',
                          flexShrink: 0,
                          marginTop: 1,
                          width: 18,
                          textAlign: 'center',
                        }}>
                          {s.done ? '✓' : idx + 1}
                        </span>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: s.done ? '#166534' : '#0f172a', textDecoration: s.done ? 'line-through' : 'none' }}>
                            {s.label}
                          </p>
                          {!s.done && (
                            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                              {s.hint}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
      {launchComplete && (
        <div style={{ marginTop: '0.8rem', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, color: '#166534', fontWeight: 700 }}>
          ✓ All launch steps complete — client is live.
        </div>
      )}

      {/* ── Plan & limits — visible right under the hero so I never miss the
          dialer + seat configuration when onboarding a new client. ── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Plan &amp; limits</h2>
          <p>
            {sdrAddonRow
              ? `${currentHoursOverride ?? sdrAddonRow.cap_value ?? '?'} hrs/wk · $${(currentRateOverride ?? 6).toFixed(2)}/hr · ${formatPriceCents(sdrAddonRow.monthly_price_cents)}/mo`
              : 'No SDR plan active'}
            {client.tier === 'enterprise' &&
              ` · ${seatUsage.used}/${seatUsage.max ?? '∞'} seats`}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: client.tier === 'enterprise' ? '1.6fr 1fr' : '1fr', gap: '0.8rem', alignItems: 'flex-start' }}>
          {/* AI SDR — free-form hrs/wk + $/hr */}
          <form action={setSdrConfig} style={{ display: 'grid', gap: 8 }}>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--royal)', margin: 0 }}>
              AI SDR · hours per week
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'flex-end' }}>
              <label style={lblStyle}>
                <span>Hrs / week</span>
                <input
                  type="number"
                  name="sdr_hours_per_week"
                  min={0}
                  max={168}
                  defaultValue={currentHoursOverride ?? sdrAddonRow?.cap_value ?? ''}
                  placeholder="e.g. 20"
                  style={inputStyle}
                />
              </label>
              <label style={lblStyle}>
                <span>$ / hr</span>
                <input
                  type="number"
                  name="sdr_dollar_per_hour"
                  min={0.5}
                  max={50}
                  step={0.25}
                  defaultValue={currentRateOverride ?? 6}
                  style={inputStyle}
                />
              </label>
              <button type="submit" className="btn approve" style={{ fontSize: 13, padding: '6px 14px' }}>Save</button>
            </div>
            {sdrAddonRow && (
              <p style={{ fontSize: 11, color: '#0f172a', margin: '2px 0 0' }}>
                Current: <strong>{currentHoursOverride ?? sdrAddonRow.cap_value} hrs/wk</strong> × <strong>${(currentRateOverride ?? 6).toFixed(2)}/hr</strong> = <strong>{formatPriceCents(sdrAddonRow.monthly_price_cents)}/mo</strong>
              </p>
            )}
            <small className="meta">Set 0 to remove the SDR plan. Monthly = hrs/wk × 4.3 × $/hr.</small>
          </form>

          {/* Enterprise: seat cap inline */}
          {client.tier === 'enterprise' && (
            <form action={saveTenantLimits} style={{ display: 'grid', gap: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--royal)', margin: 0 }}>
                Seat cap
              </p>
              <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#0b1f5c', margin: 0, letterSpacing: '0.06em' }}>
                  Active members
                </p>
                <p style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 0', color: '#0b1f5c' }}>
                  {seatUsage.used} <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>/ {seatUsage.max === null ? '∞' : seatUsage.max}</span>
                </p>
                {seatUsage.max !== null && seatUsage.used > seatUsage.max && (
                  <p style={{ fontSize: 11, color: 'var(--alert-fg, #b91c1c)', margin: '4px 0 0', fontWeight: 600 }}>⚠ Over cap</p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number"
                  name="max_seats"
                  min={0}
                  max={10000}
                  defaultValue={client.max_seats ?? ''}
                  placeholder="e.g. 25"
                  style={{ flex: 1, padding: '0.5rem', borderRadius: 8, border: '1px solid var(--border-soft)', background: '#fff', color: '#0b1f5c', fontSize: 14 }}
                />
                <button type="submit" className="btn approve" style={{ fontSize: 13, padding: '6px 14px' }}>Save</button>
              </div>
              <small className="meta">Blank = unlimited. Includes the owner.</small>
            </form>
          )}
        </div>
      </section>

      <CustomPricingPanel
        repId={client.id}
        clientEmail={client.email ?? null}
        initialOverrides={pricingOverrides}
        billingStatus={(client as unknown as Record<string, unknown>).billing_status as string | null ?? null}
        stripeSubscriptionId={(client as unknown as Record<string, unknown>).stripe_subscription_id as string | null ?? null}
      />

      {nextStep && (
        <section className="card" style={{ marginTop: '0.8rem', borderColor: 'var(--gold)' }}>
          <div className="section-head">
            <h2>Next action</h2>
            <p>owner: {nextStep.owner}</p>
          </div>
          <p className="name" style={{ fontWeight: 600, marginBottom: '0.4rem' }}>
            {fillInstructions(nextStep.title, client)}
          </p>
          <p className="meta" style={{ marginBottom: '0.6rem' }}>
            {fillInstructions(nextStep.description, client)}
          </p>
          <ol style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem' }}>
            {(nextStep.instructions ?? []).map((line, i) => (
              <li key={i} style={{ fontSize: '0.88rem', color: 'var(--royal)', whiteSpace: 'pre-wrap' }}>
                {fillInstructions(line, client)}
              </li>
            ))}
          </ol>
          <form action={toggleStep} style={{ marginTop: '0.8rem' }}>
            <input type="hidden" name="key" value={nextStep.key} />
            <input type="hidden" name="done" value="1" />
            <button type="submit" className="btn approve">Mark this step done →</button>
          </form>
        </section>
      )}

      {/* ── Google OAuth client — the tenant's own (Internal) client, else global ── */}
      {(() => {
        const g = ((client as unknown as { settings?: Record<string, unknown> | null }).settings?.google_oauth ?? null) as TenantGoogleOAuthSetting | null
        const rootDomain = getBrand((client as unknown as { brand?: string }).brand).rootDomain
        const callback = g?.redirect_uri || defaultTenantRedirectUri(rootDomain)
        const own = Boolean(g?.client_id && g?.client_secret_enc)
        return (
          <section className="card" style={{ marginTop: '0.8rem' }}>
            <div className="section-head">
              <h2>Google OAuth client</h2>
              <p>{own ? `Own client · ${g!.client_id!.slice(0, 12)}…` : 'Using the global client'}</p>
            </div>
            <p className="meta" style={{ marginBottom: '0.6rem' }}>
              For a client created in the customer&apos;s own Google Workspace (user type Internal). Authorized redirect URI to register:{' '}
              <code>{callback}</code>. The secret is encrypted before it is saved and is never shown again.
            </p>
            <form action={saveGoogleOAuth} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.2fr auto', gap: 6, alignItems: 'flex-end' }}>
              <label style={lblStyle}>
                <span>Client ID</span>
                <input name="google_client_id" defaultValue={g?.client_id ?? ''} placeholder="123-abc.apps.googleusercontent.com" style={inputStyle} />
              </label>
              <label style={lblStyle}>
                <span>Client secret</span>
                <input name="google_client_secret" type="password" autoComplete="off" placeholder={own ? 'saved (leave blank to keep)' : 'GOCSPX-…'} style={inputStyle} />
              </label>
              <label style={lblStyle}>
                <span>Redirect URI (optional)</span>
                <input name="google_redirect_uri" defaultValue={g?.redirect_uri ?? ''} placeholder={defaultTenantRedirectUri(rootDomain)} style={inputStyle} />
              </label>
              <button type="submit" className="btn approve" style={{ fontSize: 13, padding: '6px 14px' }}>Save</button>
            </form>
            {own && (
              <form action={saveGoogleOAuth} style={{ marginTop: 8 }}>
                <input type="hidden" name="clear" value="1" />
                <button type="submit" className="btn" style={{ fontSize: 12 }}>Remove own client (use global)</button>
              </form>
            )}
          </section>
        )
      })()}

      {/* ── Voice & SMS infrastructure — full-width so it's never buried ── */}
      <VoiceInfraCard
        repId={client.id}
        clientSlug={client.slug}
        clientTier={client.tier}
        twilioConfig={twilioCfg}
        revringConfig={rrCfg}
      />

      <section className="grid-2">
        <article className="card">
          <div className="section-head">
            <h2>Onboarding steps</h2>
            <p>{info.label} template</p>
          </div>
          {allSteps.length === 0 ? (
            <p className="empty">No steps.</p>
          ) : (
            <ul className="list">
              {allSteps.map((s) => {
                const isInjected = injectedSteps.some((i) => i.key === s.key)
                return (
                <li key={s.key} className="row" style={{ alignItems: 'flex-start', flexDirection: 'column', opacity: isInjected ? 0.92 : 1 }}>
                  {isInjected && (
                    <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#f59e0b' }}>
                      From plan · not yet persisted in steps
                    </p>
                  )}
                  <div style={{ display: 'flex', width: '100%', gap: '0.6rem', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <p className="name" style={{ textDecoration: s.done ? 'line-through' : 'none', opacity: s.done ? 0.6 : 1 }}>
                        {fillInstructions(s.title, client)}
                      </p>
                      <p className="meta">{fillInstructions(s.description, client)}</p>
                      <p className="meta" style={{ color: s.owner === 'client' ? '#fcb293' : 'var(--gold)' }}>
                        owner: {s.owner}
                      </p>
                    </div>
                    {!isInjected && (
                    <form action={toggleStep}>
                      <input type="hidden" name="key" value={s.key} />
                      <input type="hidden" name="done" value={s.done ? '0' : '1'} />
                      <button type="submit" className={`btn ${s.done ? 'dismiss' : 'approve'}`}>
                        {s.done ? 'Undo' : 'Mark done'}
                      </button>
                    </form>
                    )}
                  </div>
                  {!s.done && s.instructions && s.instructions.length > 0 && (
                    <details style={{ width: '100%', marginTop: '0.4rem' }}>
                      <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: 'var(--muted)' }}>
                        Show step-by-step instructions
                      </summary>
                      <ol style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', display: 'grid', gap: '0.3rem' }}>
                        {s.instructions.map((line, i) => (
                          <li key={i} style={{ fontSize: '0.85rem', color: 'var(--royal)', whiteSpace: 'pre-wrap' }}>
                            {fillInstructions(line, client)}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </li>
                )
              })}
            </ul>
          )}
        </article>

        <article className="card">
          <OnboardingLinkPanel
            brandName={brandCfg.name}
            link={
              onboardToken && onboardUrl
                ? {
                    url: onboardUrl,
                    expiresAt: onboardToken.expires_at,
                    expired: onboardExpired,
                    signed: Boolean(onboardToken.signed_at),
                    paid: Boolean(onboardToken.paid_at),
                    feeCents: Number(onboardToken.build_fee_cents) || 0,
                    loginLinkSent: Boolean(onboardToken.welcome_sent_at),
                  }
                : null
            }
          >
            <form
              action={async () => {
                'use server'
                if (!(await isAdminAuthed())) redirect('/admin/login')
                const { createOnboardingToken } = await import('@/lib/admin-onboarding')
                await createOnboardingToken(client)
                revalidatePath(`/admin/clients/${id}`)
              }}
              style={{ display: 'inline-block' }}
            >
              <PendingSubmitButton pendingLabel="Generating…">
                {onboardToken && !onboardExpired ? 'Regenerate link (cancels current)' : 'Generate onboarding link'}
              </PendingSubmitButton>
            </form>
          </OnboardingLinkPanel>
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Client login</h2>
          </div>
          <p className="meta" style={{ marginBottom: '0.5rem' }}>
            The email the client signs in with at {brandCfg.rootDomain}/login. Login emails carry a
            link to set their own password; no password is ever emailed.
          </p>

          {client.email ? (
            <form
              action={oneClickLoginLink}
              style={{
                marginBottom: '0.8rem',
                padding: '0.7rem 0.9rem',
                background: 'rgba(30,58,138,0.06)',
                border: '1px solid rgba(30,58,138,0.18)',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                gap: '0.7rem',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <p className="name" style={{ marginBottom: 2 }}>One-click onboarding</p>
                <p className="meta" style={{ margin: 0 }}>
                  Emails the owner &ldquo;Your login is ready&rdquo; with a link to set their password. A link
                  with a day or more left is re-sent as is. A second send within 2 minutes is skipped.
                </p>
              </div>
              <PendingSubmitButton>Send login link</PendingSubmitButton>
            </form>
          ) : (
            <p className="meta" style={{ marginBottom: '0.8rem', color: '#fcb293' }}>
              Add a login email below to enable one-click login links.
            </p>
          )}

          <form action={saveLoginDetails} style={{ display: 'grid', gap: '0.6rem' }}>
            <label style={lblStyle}>
              <span>Login email</span>
              <input
                name="email"
                type="email"
                defaultValue={client.email ?? ''}
                style={inputStyle}
                placeholder="client@example.com"
              />
            </label>
            <label style={lblStyle}>
              <span>Set new password (min 8 chars)</span>
              <input
                name="password"
                type="text"
                minLength={8}
                style={inputStyle}
                placeholder="Leave blank to keep current"
                autoComplete="off"
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem' }}>
              <input type="checkbox" name="send_login_link" value="1" />
              <span>Also email the owner a login link now (never the password)</span>
            </label>
            <PendingSubmitButton pendingLabel="Saving…">Save login</PendingSubmitButton>
          </form>

          <div className="section-head" style={{ marginTop: '1rem' }}>
            <h2>Integrations &amp; credentials</h2>
            <p>{client.tier} tier</p>
          </div>
          <OnboardingChecklist repId={client.id} />
          <ClientIntegrationsManager
            repId={client.id}
            tier={client.tier}
            initial={clientIntegrations}
          />

          <div className="section-head" style={{ marginTop: '1rem' }}>
            <h2>Tenant limits</h2>
            <p>{seatUsage.used} active / {seatUsage.max === null ? 'unlimited' : seatUsage.max} seats</p>
          </div>
          <p className="meta" style={{ margin: '0 0 0.6rem', fontSize: 13 }}>
            Seat cap = how many active members the owner can self-serve invite from{' '}
            <code>/dashboard/org</code>. Counts every active member including the
            owner. Leave blank for unlimited (legacy / individual tier behavior).
            AI dialer minutes and roleplay minutes are managed through the addon
            list below — those caps live on each <code>client_addon</code>.
          </p>
          <form action={saveTenantLimits} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: '1rem' }}>
            <label style={{ ...lblStyle, flex: '0 0 auto' }}>
              <span>Max seats</span>
              <input
                type="number"
                name="max_seats"
                min={0}
                max={10000}
                defaultValue={client.max_seats ?? ''}
                placeholder="e.g. 25"
                style={{ ...inputStyle, width: 130 }}
              />
            </label>
            <button type="submit" className="btn approve">Save cap</button>
            {seatUsage.max !== null && seatUsage.used > seatUsage.max && (
              <span style={{ color: 'var(--alert-fg, #b91c1c)', fontWeight: 600, fontSize: 13 }}>
                ⚠ Tenant is over cap ({seatUsage.used}/{seatUsage.max})
              </span>
            )}
          </form>

          <div className="section-head" style={{ marginTop: '1rem' }}>
            <h2>Other settings</h2>
          </div>
          <form action={saveIntegrations} style={{ display: 'grid', gap: '0.6rem' }}>
            <label style={lblStyle}>
              <span>Claude API key (optional override / BYOK)</span>
              <input
                name="claude_api_key"
                defaultValue={client.claude_api_key ?? ''}
                style={inputStyle}
                placeholder="sk-ant-..."
              />
            </label>
            <label style={lblStyle}>
              <span>Build notes (private)</span>
              <textarea
                name="build_notes"
                defaultValue={client.build_notes ?? ''}
                rows={4}
                style={{ ...inputStyle, fontFamily: 'inherit' }}
                placeholder="ICP, objection playbook, gotchas, passwords stored in 1Password, etc."
              />
            </label>
            <button type="submit" className="btn approve">Save</button>
          </form>

          <div className="section-head" style={{ marginTop: '1rem' }}>
            <h2>Activity</h2>
            <p>{events.length}</p>
          </div>
          <form action={addNote} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input name="body" placeholder="Add a note…" style={{ ...inputStyle, flex: 1 }} />
            <button type="submit" className="btn approve">Log</button>
          </form>
          {events.length === 0 ? (
            <p className="empty">No activity yet.</p>
          ) : (
            <ul className="list">
              {events.map((e) => (
                <li key={(e as { id: string }).id} className="row">
                  <div>
                    <p className="name">{(e as { title: string }).title}</p>
                    {(e as { body?: string | null }).body && (
                      <p className="meta">{(e as { body?: string | null }).body}</p>
                    )}
                    <p className="meta">
                      {(e as { kind: string }).kind} ·{' '}
                      {new Date((e as { created_at: string }).created_at).toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {/* ── AI Dialer liability agreements ─────────────────────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>AI Dialer · liability agreements</h2>
          <p>{liabilityAgreements.length} signed · current version <code>{LIABILITY_VERSION}</code></p>
        </div>
        {liabilityAgreements.length === 0 ? (
          <p className="empty">
            Nobody on this account has signed yet. The liability gate fires the first time any
            member visits /dashboard/dialer.
          </p>
        ) : (
          <ul className="list" style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            {liabilityAgreements.map((a) => {
              const member = memberById.get(a.member_id)
              const stale = a.agreement_version !== LIABILITY_VERSION
              return (
                <li
                  key={a.id}
                  className="row"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
                >
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <p className="name" style={{ margin: 0, fontWeight: 600 }}>
                      {a.signature_name}
                      {member && member.display_name !== a.signature_name && (
                        <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                          ({member.display_name} · {member.role})
                        </span>
                      )}
                    </p>
                    <p className="meta" style={{ margin: '2px 0 0', fontSize: 12 }}>
                      Signed {new Date(a.signed_at).toLocaleString('en-US')}
                      {a.signed_ip ? ` · IP ${a.signed_ip}` : ''}
                      {' · '}
                      <code>{a.agreement_version}</code>
                      {stale && (
                        <span style={{ marginLeft: 6, color: 'var(--alert-fg, #b91c1c)', fontWeight: 600 }}>
                          (older version — re-sign required on next dialer visit)
                        </span>
                      )}
                    </p>
                  </div>
                  {a.pdf_storage_path ? (
                    <a
                      href={`/api/admin/liability/download?id=${a.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn"
                      style={{ fontSize: 12, padding: '5px 12px' }}
                    >
                      View signed copy →
                    </a>
                  ) : (
                    <span className="meta" style={{ fontSize: 12 }}>
                      snapshot upload missing — agreement_text on the row is the audit fallback
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Active addons ───────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Active add-ons</h2>
          <p>from quote · {clientAddons.filter(a => a.status === 'active').length} active</p>
        </div>

        {clientAddons.length === 0 ? (
          <p className="empty">No add-ons seeded yet — convert from a prospect with a cart, or add manually below.</p>
        ) : (
          <ul className="list" style={{ marginBottom: '0.75rem' }}>
            {clientAddons.map((a) => {
              const def = ADDON_CATALOG[a.addon_key]
              const label = def?.label ?? a.addon_key
              const price = `$${(a.monthly_price_cents / 100).toFixed(0)}/mo`
              const capStr = a.cap_value ? `${a.cap_value} ${a.cap_unit}` : 'unlimited'
              const locked = a.locked_price_until
                ? `price locked until ${new Date(a.locked_price_until).toLocaleDateString()}`
                : null
              const statusColor =
                a.status === 'active'   ? { background: 'rgba(16,185,129,0.12)', color: '#065f46', border: 'rgba(16,185,129,0.35)' } :
                a.status === 'over_cap' ? { background: 'rgba(245,158,11,0.12)', color: '#92400e', border: 'rgba(245,158,11,0.35)' } :
                a.status === 'paused'   ? { background: 'rgba(100,116,139,0.12)', color: '#334155', border: 'rgba(100,116,139,0.3)' } :
                                          { background: 'rgba(239,68,68,0.12)', color: 'var(--alert-fg, #991b1b)', border: 'rgba(239,68,68,0.3)' }
              return (
                <li key={a.id} className="row" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="name" style={{ marginBottom: '0.1rem' }}>{label}</p>
                    <p className="meta">{price} · {capStr}{locked ? ` · ${locked}` : ''}</p>
                  </div>
                  <span style={{
                    padding: '2px 10px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    border: `1px solid ${statusColor.border}`,
                    background: statusColor.background,
                    color: statusColor.color,
                    flexShrink: 0,
                  }}>
                    {a.status}
                  </span>
                  <form action={toggleAddonStatus} style={{ display: 'flex', gap: '0.4rem' }}>
                    <input type="hidden" name="addon_id" value={a.id} />
                    {a.status === 'active' ? (
                      <>
                        <input type="hidden" name="status" value="paused" />
                        <button type="submit" className="btn dismiss" style={{ padding: '2px 10px', fontSize: '0.76rem' }}>Pause</button>
                      </>
                    ) : a.status === 'paused' ? (
                      <>
                        <input type="hidden" name="status" value="active" />
                        <button type="submit" className="btn approve" style={{ padding: '2px 10px', fontSize: '0.76rem' }}>Resume</button>
                      </>
                    ) : null}
                  </form>
                </li>
              )
            })}
          </ul>
        )}

        {/* Add an addon post-conversion */}
        <form action={addAddon} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border-soft)', paddingTop: '0.75rem' }}>
          <label style={{ ...lblStyle, flex: 1, minWidth: 180 }}>
            <span>Add add-on</span>
            <select name="addon_key" style={{ ...inputStyle, cursor: 'pointer' }}>
              {(Object.values(ADDON_CATALOG) as typeof ADDON_CATALOG[AddonKey][]).filter(d => d.key !== 'base_build').map(d => (
                <option key={d.key} value={d.key}>
                  {d.label} — ${(d.monthly_price_cents / 100).toFixed(0)}/mo
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn approve" style={{ alignSelf: 'flex-end' }}>Add</button>
        </form>
      </section>

      {/* ── Campaign Setup ────────────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: '1.5rem' }}>
        <div className="section-head">
          <h2>Campaign Setup</h2>
          <p>Health Insurance AI Agent · Local Presence Pool</p>
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>

          {/* AI Agent row */}
          <div style={{
            padding: '0.75rem 1rem',
            background: healthInsuranceAgent ? 'rgba(16,185,129,0.06)' : '#f9fafb',
            border: `1px solid ${healthInsuranceAgent ? 'rgba(16,185,129,0.3)' : 'var(--border-soft)'}`,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}>
            <div>
              <p className="name" style={{ margin: 0 }}>Health Insurance AI Agent — Rachel</p>
              {healthInsuranceAgent ? (
                <p className="meta" style={{ margin: '2px 0 0' }}>
                  {healthInsuranceAgent.name} · <code>{healthInsuranceAgent.id}</code> · status: <strong>{healthInsuranceAgent.status}</strong>
                </p>
              ) : (
                <p className="meta" style={{ margin: '2px 0 0', color: '#92400e' }}>
                  Not provisioned — creates AiSalesperson from health insurance template
                </p>
              )}
            </div>
            {healthInsuranceAgent ? (
              <span style={{ fontSize: 11, background: '#d1fae5', color: '#065f46', padding: '2px 10px', borderRadius: 999, fontWeight: 700 }}>
                ✓ Ready
              </span>
            ) : (
              <form action={provisionHealthInsuranceAgent}>
                <button type="submit" className="btn approve">Provision Agent</button>
              </form>
            )}
          </div>

          {/* Local presence numbers */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
              <p className="name" style={{ margin: 0 }}>Local Presence Numbers</p>
              <span style={{
                fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 999,
                background: localPresenceCount > 0 ? '#d1fae5' : '#fef3c7',
                color: localPresenceCount > 0 ? '#065f46' : '#92400e',
              }}>
                {localPresenceCount} in pool
              </span>
            </div>
            <p className="meta" style={{ margin: '0 0 0.5rem' }}>
              Paste E.164 numbers (one per line). Neighbor dialing selects the closest area code automatically.
            </p>
            <form action={importLocalPresenceNumbers} style={{ display: 'grid', gap: 6 }}>
              <textarea
                name="numbers"
                rows={5}
                placeholder={'+12145550001\n+13125550002\n+12035550003'}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
              />
              <button type="submit" className="btn approve" style={{ justifySelf: 'start' }}>
                Import Numbers
              </button>
            </form>
          </div>

          {/* Webhook reference */}
          <div style={{ background: 'var(--paper-2)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '0.65rem 0.85rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.3rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.7rem' }}>
              SakredCRM Webhook Config
            </div>
            <div style={{ display: 'grid', gap: '0.3rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>
              <div><strong>Inbound URL (SakredCRM → VC):</strong></div>
              <div style={{ background: '#f8f9fc', border: '1px solid var(--border-soft)', borderRadius: 6, padding: '0.35rem 0.6rem', wordBreak: 'break-all' }}>
                {`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://virtualcloser.com'}/api/webhooks/sakredcrm/${client.id}/lead`}
              </div>
              <div style={{ marginTop: '0.3rem', color: '#6b7280', fontSize: '0.75rem' }}>
                rep_id is in the URL — no env vars needed. Agent auto-resolved from DB by product_intent.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Furnace Integration ───────────────────────────────────────────── */}
      <section className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.15rem', fontSize: '1rem', fontWeight: 700 }}>
          Furnace Integration
          {isFurnaceClient && (
            <span style={{ marginLeft: 8, fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24', borderRadius: 6, padding: '1px 8px', fontWeight: 600, verticalAlign: 'middle' }}>
              FURNACE CLIENT
            </span>
          )}
        </h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Furnace-originated leads auto-queue to the active AI SDR. Disposition changes sync back to Furnace automatically. Attribution (Meta CAPI, Google) is handled by Furnace — VC just sends disposition updates.
        </p>

        <form action={saveFurnaceConfig} style={{ display: 'grid', gap: '0.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.88rem' }}>
            <input type="hidden" name="furnace_enabled" value="0" />
            <input
              type="checkbox"
              name="furnace_enabled"
              value="1"
              defaultChecked={isFurnaceClient}
              style={{ width: 16, height: 16 }}
            />
            <span>This is a Furnace client — enable two-way sync</span>
          </label>

          <label style={lblStyle}>
            <span>Furnace client_id (UUID from Furnace — used for your records)</span>
            <input
              name="furnace_client_id"
              defaultValue={furnaceCfg?.client_id ?? ''}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              style={inputStyle}
            />
          </label>

          <div style={{ background: 'var(--paper-2)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '0.65rem 0.85rem', fontSize: '0.78rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.3rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.7rem' }}>
              Furnace dev needs these
            </div>
            <div style={{ display: 'grid', gap: '0.3rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>
              <div><strong>Inbound webhook URL</strong> (Furnace → VC new leads):</div>
              <div style={{ background: '#f8f9fc', border: '1px solid var(--border-soft)', borderRadius: 6, padding: '0.35rem 0.6rem', wordBreak: 'break-all' }}>
                {`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://virtualcloser.com'}/api/webhooks/furnace/${client.id}`}
              </div>
              <div style={{ marginTop: '0.3rem' }}><strong>Header:</strong> <code>x-furnace-secret: FURNACE_INBOUND_SECRET</code> (share this env var value)</div>
              <div style={{ marginTop: '0.3rem' }}><strong>VC → Furnace sync URL:</strong> <code>https://www.furnaceleads.com/api/vc/sync</code></div>
              <div><strong>VC auth header:</strong> <code>x-webhook-secret: LEADS_WEBHOOK_SECRET</code> (Furnace must share this value)</div>
            </div>
          </div>

          <button type="submit" className="btn approve" style={{ justifySelf: 'start' }}>Save Furnace config</button>
        </form>
      </section>

    </main>
  )
}

const lblStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.3rem',
  fontSize: '0.78rem',
  color: '#5a6aa6',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const inputStyle: React.CSSProperties = {
  padding: '0.55rem',
  borderRadius: 10,
  border: '1px solid var(--border-soft)',
  background: '#ffffff',
  color: '#0b1f5c',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  textTransform: 'none',
  letterSpacing: 'normal',
}


