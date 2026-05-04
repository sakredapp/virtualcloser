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
import { sendEmail, welcomeEmail, generatePassword } from '@/lib/email'
import { telegramBotUsername } from '@/lib/telegram'
import { listClientIntegrations } from '@/lib/client-integrations'
import { getSeatUsage, listMembers } from '@/lib/members'
import { resolveActiveHourPackage } from '@/lib/entitlements'
import { listAgreementsForRep, CURRENT_VERSION as LIABILITY_VERSION } from '@/lib/liabilityAgreement'
import ClientIntegrationsManager from './ClientIntegrationsManager'
import OnboardingChecklist from './OnboardingChecklist'

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
    listMembers(client.id),
  ])
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
      telegram_chat_id: String(formData.get('telegram_chat_id') ?? '') || null,
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
    const sendWelcome = formData.get('send_welcome') === '1'
    const patch: Record<string, unknown> = { email }
    if (password && password.length >= 8) {
      patch.password_hash = await hashPassword(password)
    }
    await updateClientRow(id, patch as Partial<NonNullable<typeof client>>)
    await addClientEvent({
      repId: id,
      kind: 'billing',
      title: password ? 'Login credentials updated (email + password)' : 'Login email updated',
    })

    // Fire welcome email if requested + we have everything we need.
    if (sendWelcome && email && password && password.length >= 8) {
      const fresh = await getClient(id)
      if (fresh) {
        const tierLabel = (TIER_INFO[fresh.tier] ?? TIER_INFO.individual).label
        const tpl = welcomeEmail({
          toEmail: email,
          displayName: fresh.display_name,
          slug: fresh.slug,
          password,
          telegramLinkCode: fresh.telegram_link_code,
          telegramBotUsername: telegramBotUsername(),
          tierLabel,
        })
        const result = await sendEmail({
          to: email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        })
        await addClientEvent({
          repId: id,
          kind: 'email',
          title: result.ok ? `Welcome email sent to ${email}` : `Welcome email FAILED: ${result.error ?? 'unknown'}`,
        })
      }
    }

    revalidatePath(`/admin/clients/${id}`)
  }

  async function generateAndSendWelcome(_formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const fresh = await getClient(id)
    if (!fresh || !fresh.email) {
      await addClientEvent({
        repId: id,
        kind: 'email',
        title: 'Welcome email FAILED: no email on file for client',
      })
      revalidatePath(`/admin/clients/${id}`)
      return
    }
    const password = generatePassword()
    await updateClientRow(id, {
      password_hash: await hashPassword(password),
    } as Partial<NonNullable<typeof client>>)

    const tierLabel = (TIER_INFO[fresh.tier] ?? TIER_INFO.individual).label
    const tpl = welcomeEmail({
      toEmail: fresh.email,
      displayName: fresh.display_name,
      slug: fresh.slug,
      password,
      telegramLinkCode: fresh.telegram_link_code,
      telegramBotUsername: telegramBotUsername(),
      tierLabel,
    })
    const result = await sendEmail({
      to: fresh.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    })
    await addClientEvent({
      repId: id,
      kind: 'email',
      title: result.ok
        ? `Welcome email accepted by Resend (id ${result.id ?? '?'}) → ${fresh.email}`
        : `Welcome email FAILED: ${result.error ?? 'unknown'}`,
      body: result.ok ? 'Resend accepted the email. Check Resend dashboard → Emails for delivery status. If client says they didn\'t get it: (1) check spam, (2) verify sending domain in Resend, (3) confirm RESEND_FROM uses a verified domain.' : undefined,
    })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function resendWelcomeEmail(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const password = String(formData.get('password') ?? '')
    if (!password || password.length < 8) return

    const fresh = await getClient(id)
    if (!fresh || !fresh.email) return

    // Update password to the one we're emailing (so client can actually log in).
    await updateClientRow(id, {
      password_hash: await hashPassword(password),
    } as Partial<NonNullable<typeof client>>)

    const tierLabel = (TIER_INFO[fresh.tier] ?? TIER_INFO.individual).label
    const tpl = welcomeEmail({
      toEmail: fresh.email,
      displayName: fresh.display_name,
      slug: fresh.slug,
      password,
      telegramLinkCode: fresh.telegram_link_code,
      telegramBotUsername: telegramBotUsername(),
      tierLabel,
    })
    const result = await sendEmail({
      to: fresh.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    })
    await addClientEvent({
      repId: id,
      kind: 'email',
      title: result.ok
        ? `Welcome email re-sent to ${fresh.email} (password reset)`
        : `Welcome email FAILED: ${result.error ?? 'unknown'}`,
    })
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

  async function setHourPackage(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const newKey = String(formData.get('hour_package_key') ?? '').trim()

    // Drop any currently-active hour package (mutually exclusive).
    await supabase
      .from('client_addons')
      .delete()
      .eq('rep_id', id)
      .in('addon_key', HOUR_PACKAGE_KEYS as unknown as string[])

    if (!newKey || !isHourPackage(newKey)) {
      // Empty value = "no SDR plan" — leave deleted.
      await addClientEvent({
        repId: id,
        kind: 'billing',
        title: 'Hour package removed (no SDR plan active)',
      })
      revalidatePath(`/admin/clients/${id}`)
      return
    }

    const def = ADDON_CATALOG[newKey]
    await supabase.from('client_addons').upsert(
      {
        rep_id: id,
        addon_key: def.key,
        status: 'active',
        monthly_price_cents: def.monthly_price_cents,
        cap_value: def.cap_value,
        cap_unit: def.cap_unit,
        source: 'admin_swap',
      },
      { onConflict: 'rep_id,addon_key' },
    )
    await addClientEvent({
      repId: id,
      kind: 'billing',
      title: `Hour package set to ${def.label} (${def.cap_value} hrs/wk)`,
    })
    revalidatePath(`/admin/clients/${id}`)
  }

  /**
   * Override the hours/wk and/or $/hr on the active hour package for this
   * tenant. Stored on client_addons:
   *   - cap_value          → custom hours/wk
   *   - monthly_price_cents → recalculated from hours/mo × custom $/hr
   *   - metadata.unit_price_cents_override → custom $/hr (so we can
   *     reconstruct the rate later without losing the catalog default)
   * Either field can be left blank to revert to the catalog default.
   */
  async function saveSdrOverride(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')

    const hoursRaw = String(formData.get('custom_hours_per_week') ?? '').trim()
    const rateRaw = String(formData.get('custom_dollar_per_hour') ?? '').trim()

    // Resolve the active hour-package row.
    const { data: row } = await supabase
      .from('client_addons')
      .select('id, addon_key, cap_value, monthly_price_cents, metadata')
      .eq('rep_id', id)
      .in('addon_key', HOUR_PACKAGE_KEYS as unknown as string[])
      .maybeSingle()
    if (!row) return

    const def = ADDON_CATALOG[(row as { addon_key: AddonKey }).addon_key]
    const customHours =
      hoursRaw === '' ? null : Math.max(1, Math.min(168, Math.floor(Number(hoursRaw))))
    const customDollarPerHour =
      rateRaw === '' ? null : Math.max(0.01, Math.min(50, Number(rateRaw)))

    if (customHours !== null && !Number.isFinite(customHours)) return
    if (customDollarPerHour !== null && !Number.isFinite(customDollarPerHour)) return

    const effectiveHours = customHours ?? def.cap_value ?? 40
    const effectiveDollar = customDollarPerHour ?? 6 // $6 = catalog individual baseline
    // Same math as the offer page: hours/wk × 4.3 weeks/mo × $/hr × 100 cents
    const newMonthlyCents = Math.round(effectiveHours * 4.3 * effectiveDollar * 100)

    const existingMeta = ((row as { metadata?: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>
    const newMeta: Record<string, unknown> = { ...existingMeta }
    if (customDollarPerHour !== null) {
      newMeta.unit_price_cents_override = Math.round(customDollarPerHour * 100)
    } else {
      delete newMeta.unit_price_cents_override
    }
    if (customHours !== null) {
      newMeta.hours_per_week_override = customHours
    } else {
      delete newMeta.hours_per_week_override
    }

    await supabase
      .from('client_addons')
      .update({
        cap_value: customHours ?? def.cap_value,
        monthly_price_cents: newMonthlyCents,
        metadata: newMeta,
      })
      .eq('id', (row as { id: string }).id)

    const summary =
      `SDR override · ${customHours !== null ? `${customHours} hrs/wk` : 'catalog hrs'} ` +
      `× ${customDollarPerHour !== null ? `$${customDollarPerHour.toFixed(2)}/hr` : 'catalog $/hr'} ` +
      `= ${(newMonthlyCents / 100).toFixed(0)}/mo`
    await addClientEvent({ repId: id, kind: 'billing', title: summary })
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

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Client</p>
        <h1>{client.display_name}</h1>
        <p className="sub">
          {client.slug}.virtualcloser.com · {info.label} · ${client.monthly_fee}/mo · build ${client.build_fee}
        </p>
        <p className="nav">
          <Link href="/admin/clients">← All clients</Link>
          <span>·</span>
          <Link href={`/admin/clients/${client.id}/members`}>Members & teams</Link>
          <span>·</span>
          <Link href={`/dashboard`}>Open their dashboard</Link>
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
            <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 6, background: '#ff2800', color: '#fff' }}>
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

      {/* ── Plan & limits — visible right under the hero so I never miss the
          dialer + seat configuration when onboarding a new client. ── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Plan &amp; limits</h2>
          <p>
            {activeHourPackage
              ? `${ADDON_CATALOG[activeHourPackage].label} · ${ADDON_CATALOG[activeHourPackage].cap_value} hrs/wk`
              : 'No SDR plan active'}
            {client.tier === 'enterprise' &&
              ` · ${seatUsage.used}/${seatUsage.max ?? '∞'} seats`}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: client.tier === 'enterprise' ? '1.6fr 1fr' : '1fr', gap: '0.8rem', alignItems: 'flex-start' }}>
          {/* AI SDR plan picker */}
          <form action={setHourPackage} style={{ display: 'grid', gap: 8 }}>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--royal)', margin: 0 }}>
              AI SDR · weekly hour package
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6 }}>
              <button
                type="submit"
                name="hour_package_key"
                value=""
                style={{
                  ...hourCardBtn,
                  background: !activeHourPackage ? '#fef9c3' : '#ffffff',
                  border: !activeHourPackage ? '2px solid #0b1f5c' : '1px solid #e6d9ac',
                }}
              >
                <strong style={{ fontSize: 13 }}>Skip</strong>
                <span style={{ fontSize: 11, color: '#6b7280' }}>No plan</span>
              </button>
              {HOUR_PACKAGE_KEYS.map((key) => {
                const def = ADDON_CATALOG[key]
                const active = activeHourPackage === key
                return (
                  <button
                    key={key}
                    type="submit"
                    name="hour_package_key"
                    value={key}
                    style={{
                      ...hourCardBtn,
                      background: active ? '#fef9c3' : '#ffffff',
                      border: active ? '2px solid #0b1f5c' : '1px solid #e6d9ac',
                    }}
                  >
                    <strong style={{ fontSize: 14 }}>{def.cap_value} hrs/wk</strong>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>${(def.monthly_price_cents / 100).toFixed(0)}/mo</span>
                  </button>
                )
              })}
            </div>
            <small className="meta">Click to swap. Mutually exclusive — only one plan can be active.</small>
          </form>

          {/* SDR override — only meaningful when an hour package is active. */}
          {activeHourPackage && sdrAddonRow && (
            <form action={saveSdrOverride} style={{ display: 'grid', gap: 6, marginTop: 12, padding: '10px 12px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--royal)', margin: 0 }}>
                SDR override · {ADDON_CATALOG[activeHourPackage].label}
              </p>
              <p className="meta" style={{ margin: 0, fontSize: 12 }}>
                Catalog: {ADDON_CATALOG[activeHourPackage].cap_value} hrs/wk × $6/hr ={' '}
                {((ADDON_CATALOG[activeHourPackage].cap_value ?? 0) * 4.3 * 6).toFixed(0)}/mo. Override either field
                for a custom deal — leave blank to revert to catalog.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'flex-end' }}>
                <label style={{ ...lblStyle }}>
                  <span>Custom hrs/wk</span>
                  <input
                    type="number"
                    name="custom_hours_per_week"
                    min={1}
                    max={168}
                    defaultValue={currentHoursOverride ?? ''}
                    placeholder={String(ADDON_CATALOG[activeHourPackage].cap_value ?? 40)}
                    style={inputStyle}
                  />
                </label>
                <label style={{ ...lblStyle }}>
                  <span>Custom $/hr</span>
                  <input
                    type="number"
                    name="custom_dollar_per_hour"
                    min={0.5}
                    max={50}
                    step={0.25}
                    defaultValue={currentRateOverride ?? ''}
                    placeholder="6.00"
                    style={inputStyle}
                  />
                </label>
                <button type="submit" className="btn approve" style={{ fontSize: 13, padding: '6px 14px' }}>Save</button>
              </div>
              <p className="meta" style={{ margin: 0, fontSize: 11 }}>
                Stored on client_addons.metadata so the catalog price stays clean. The displayed
                client price recalculates as <code>hrs/wk × 4.3 × $/hr</code>.
              </p>
              <p style={{ fontSize: 11, color: '#0f172a', margin: '2px 0 0' }}>
                Current effective: <strong>{currentHoursOverride ?? ADDON_CATALOG[activeHourPackage].cap_value} hrs/wk</strong> × <strong>${(currentRateOverride ?? 6).toFixed(2)}/hr</strong> = <strong>{formatPriceCents(sdrAddonRow.monthly_price_cents)}/mo</strong>
              </p>
            </form>
          )}

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
                  <p style={{ fontSize: 11, color: '#b91c1c', margin: '4px 0 0', fontWeight: 600 }}>⚠ Over cap</p>
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
          <div className="section-head">
            <h2>Client login</h2>
          </div>
          <p className="meta" style={{ marginBottom: '0.5rem' }}>
            The email + password the client uses at {process.env.ROOT_DOMAIN ?? 'virtualcloser.com'}/login.
            Leave password blank to keep the current one. Tick &ldquo;send welcome email&rdquo; to
            email them their credentials + Telegram link instructions.
          </p>

          {client.email ? (
            <form
              action={generateAndSendWelcome}
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
                  Generates a strong password, saves it, and emails {client.email} the full welcome.
                </p>
              </div>
              <button type="submit" className="btn approve">
                Generate password &amp; send welcome
              </button>
            </form>
          ) : (
            <p className="meta" style={{ marginBottom: '0.8rem', color: '#fcb293' }}>
              Add a login email below to enable one-click welcome emails.
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
              <input type="checkbox" name="send_welcome" value="1" defaultChecked />
              <span>Email this password + Telegram link to the client now</span>
            </label>
            <button type="submit" className="btn approve">Save login</button>
          </form>

          {client.email && (
            <details style={{ marginTop: '0.8rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--muted)' }}>
                Resend welcome email (rotates password)
              </summary>
              <form action={resendWelcomeEmail} style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                <label style={lblStyle}>
                  <span>New password to email (min 8 chars)</span>
                  <input
                    name="password"
                    type="text"
                    minLength={8}
                    required
                    style={inputStyle}
                    placeholder="Their new password"
                    autoComplete="off"
                  />
                </label>
                <button type="submit" className="btn dismiss">
                  Re-send welcome email to {client.email}
                </button>
              </form>
            </details>
          )}

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
              <span style={{ color: '#b91c1c', fontWeight: 600, fontSize: 13 }}>
                ⚠ Tenant is over cap ({seatUsage.used}/{seatUsage.max})
              </span>
            )}
          </form>

          <div className="section-head" style={{ marginTop: '1rem' }}>
            <h2>Other settings</h2>
          </div>
          <form action={saveIntegrations} style={{ display: 'grid', gap: '0.6rem' }}>
            <label style={lblStyle}>
              <span>Telegram chat ID</span>
              <input
                name="telegram_chat_id"
                defaultValue={client.telegram_chat_id ?? ''}
                style={inputStyle}
                placeholder="e.g. 123456789 or -1001234567890"
              />
            </label>
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
                        <span style={{ marginLeft: 6, color: '#b91c1c', fontWeight: 600 }}>
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
                                          { background: 'rgba(239,68,68,0.12)', color: '#991b1b', border: 'rgba(239,68,68,0.3)' }
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

const hourCardBtn: React.CSSProperties = {
  borderRadius: 8,
  padding: '8px 10px',
  cursor: 'pointer',
  textAlign: 'center',
  fontSize: 13,
  color: '#0b1f5c',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontFamily: 'inherit',
}
