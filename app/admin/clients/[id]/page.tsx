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
import { TIER_INFO, fillInstructions, type OnboardingStep } from '@/lib/onboarding'
import { ADDON_CATALOG, type AddonKey } from '@/lib/addons'
import { supabase } from '@/lib/supabase'
import { sendEmail, welcomeEmail, generatePassword } from '@/lib/email'
import { telegramBotUsername } from '@/lib/telegram'
import { listClientIntegrations } from '@/lib/client-integrations'
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

  const [summary, events, clientIntegrations, clientAddonsResult] = await Promise.all([
    getClientSummary(client.id),
    listClientEvents(client.id, 20),
    listClientIntegrations(client.id),
    supabase
      .from('client_addons')
      .select('*')
      .eq('rep_id', client.id)
      .order('activated_at', { ascending: true }),
  ])
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
  }[]

  const steps = (client.onboarding_steps ?? []) as OnboardingStep[]
  const doneCount = steps.filter((s) => s.done).length
  const pct = Math.round((doneCount / Math.max(steps.length, 1)) * 100)
  const info = TIER_INFO[client.tier] ?? TIER_INFO.individual
  const nextStep = steps.find((s) => !s.done) ?? null

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
          <p className="hint">{doneCount} / {steps.length} steps</p>
        </article>
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
          {steps.length === 0 ? (
            <p className="empty">No steps.</p>
          ) : (
            <ul className="list">
              {steps.map((s) => (
                <li key={s.key} className="row" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
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
                    <form action={toggleStep}>
                      <input type="hidden" name="key" value={s.key} />
                      <input type="hidden" name="done" value={s.done ? '0' : '1'} />
                      <button type="submit" className={`btn ${s.done ? 'dismiss' : 'approve'}`}>
                        {s.done ? 'Undo' : 'Mark done'}
                      </button>
                    </form>
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
              ))}
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
        <form action={addAddon} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--line, #e6e1d8)', paddingTop: '0.75rem' }}>
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
  border: '1px solid #e6d9ac',
  background: '#ffffff',
  color: '#0b1f5c',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  textTransform: 'none',
  letterSpacing: 'normal',
}
