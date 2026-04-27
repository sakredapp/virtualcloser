import { Resend } from 'resend'

const FROM_DEFAULT = process.env.RESEND_FROM ?? 'Virtual Closer <hello@virtualcloser.com>'
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

let _client: Resend | null = null
function client(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!_client) _client = new Resend(process.env.RESEND_API_KEY)
  return _client
}

export async function sendEmail(input: {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const c = client()
  if (!c) {
    console.warn('[email] RESEND_API_KEY not set — skipping send to', input.to)
    return { ok: false, error: 'RESEND_API_KEY not set' }
  }
  try {
    const res = await c.emails.send({
      from: FROM_DEFAULT,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    })
    if (res.error) return { ok: false, error: res.error.message }
    return { ok: true, id: res.data?.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return { ok: false, error: message }
  }
}

// ── Templates ──────────────────────────────────────────────────────────────

// Red brand tokens (mirrors globals.css).
const BRAND_RED = '#ff2800'
const BRAND_INK = '#0f0f0f'
const BRAND_PAPER = '#ffffff'
const BRAND_PAPER_2 = '#f7f4ef'
const BRAND_MUTED = '#5a5a5a'
const BRAND_BORDER = 'rgba(15,15,15,0.12)'

function shell(opts: { title: string; preheader?: string; body: string }): string {
  const logoUrl = `https://${ROOT_DOMAIN}/logo.png`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escape(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND_RED};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND_INK};">
${opts.preheader ? `<span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${escape(opts.preheader)}</span>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_RED};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td align="center" style="padding-bottom:18px;">
        <a href="https://${ROOT_DOMAIN}" style="text-decoration:none;display:inline-block;">
          <img src="${logoUrl}" alt="Virtual Closer" width="64" height="64" style="display:block;border-radius:14px;border:1px solid ${BRAND_BORDER};background:${BRAND_PAPER};">
        </a>
      </td></tr>
      <tr><td style="background:${BRAND_PAPER};border:1px solid ${BRAND_INK};border-radius:14px;padding:32px;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND_RED};font-weight:700;">Virtual Closer</p>
        <h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;color:${BRAND_INK};font-weight:700;">${escape(opts.title)}</h1>
        <div style="font-size:15px;line-height:1.6;color:${BRAND_INK};">
          ${opts.body}
        </div>
        <p style="margin:32px 0 0;padding-top:20px;border-top:1px solid ${BRAND_BORDER};font-size:12px;color:${BRAND_MUTED};">
          Sent by Virtual Closer · <a href="https://${ROOT_DOMAIN}" style="color:${BRAND_RED};text-decoration:none;">${ROOT_DOMAIN}</a>
        </p>
      </td></tr>
      <tr><td align="center" style="padding-top:14px;font-size:11px;color:rgba(255,255,255,0.82);">
        You're receiving this because an account was created for you at Virtual Closer.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type WelcomeEmailInput = {
  toEmail: string
  displayName: string
  slug: string
  password: string // plaintext, only used here once
  telegramLinkCode: string | null
  telegramBotUsername: string
  tierLabel: string
}

export function welcomeEmail(input: WelcomeEmailInput) {
  const dashboardUrl = `https://${input.slug}.${ROOT_DOMAIN}/dashboard`
  const loginUrl = `https://${ROOT_DOMAIN}/login`
  const botUrl = `https://t.me/${input.telegramBotUsername}`
  const code = input.telegramLinkCode ?? ''

  const body = `
    <p style="margin:0 0 16px;">Hey ${escape(input.displayName.split(' ')[0] || input.displayName)},</p>
    <p style="margin:0 0 20px;">Your <strong>${escape(input.tierLabel)}</strong> workspace is live. Two quick steps and you're running.</p>

    <h2 style="margin:24px 0 10px;font-size:16px;color:${BRAND_RED};">1. Sign in to your dashboard</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" style="background:${BRAND_PAPER_2};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:14px 18px;font-size:14px;width:100%;">
      <tr><td style="padding:3px 0;"><strong style="color:${BRAND_RED};">Email:</strong> &nbsp;${escape(input.toEmail)}</td></tr>
      <tr><td style="padding:3px 0;"><strong style="color:${BRAND_RED};">Password:</strong> &nbsp;<code style="font-family:'SF Mono',Menlo,monospace;font-size:14px;background:${BRAND_PAPER};padding:2px 6px;border-radius:4px;border:1px solid ${BRAND_BORDER};">${escape(input.password)}</code></td></tr>
      <tr><td style="padding:3px 0;"><strong style="color:${BRAND_RED};">Workspace:</strong> &nbsp;${escape(input.slug)}.${escape(ROOT_DOMAIN)}</td></tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;">
      <tr><td bgcolor="${BRAND_RED}" style="border-radius:10px;">
        <a href="${loginUrl}" style="display:inline-block;padding:12px 22px;background:${BRAND_RED};color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;border-radius:10px;letter-spacing:0.04em;text-transform:uppercase;">Sign in →</a>
      </td></tr>
    </table>
    <p style="margin:6px 0 0;font-size:12px;color:${BRAND_MUTED};">You can change your password from the dashboard once you're in.</p>

    <h2 style="margin:30px 0 10px;font-size:16px;color:${BRAND_RED};">2. Connect your Telegram assistant</h2>
    <p style="margin:0 0 10px;">This is the part you'll actually use. Your assistant lives on Telegram — text or voice-note it like a real person, and your dashboard updates automatically.</p>
    <ol style="margin:0 0 14px;padding-left:20px;">
      <li style="margin-bottom:6px;">Message <a href="${botUrl}" style="color:${BRAND_RED};font-weight:600;">@${escape(input.telegramBotUsername)}</a> on Telegram and tap <strong>Start</strong>.</li>
      <li style="margin-bottom:6px;">Send this exact message:<br>
        <code style="display:inline-block;background:${BRAND_PAPER_2};border:1px solid ${BRAND_BORDER};padding:6px 12px;border-radius:6px;margin-top:6px;font-family:'SF Mono',Menlo,monospace;font-size:14px;">/link ${escape(code)}</code>
      </li>
      <li>You'll get a confirmation. That's it.</li>
    </ol>

    <h2 style="margin:30px 0 10px;font-size:16px;color:${BRAND_RED};">What it can do</h2>
    <ul style="margin:0 0 16px;padding-left:20px;">
      <li style="margin-bottom:4px;">Talk to it: <em>"call Dana Thursday about pricing"</em>, <em>"goal: 10 closed deals this month"</em>, <em>"Ben from Acme is hot, demo Tuesday"</em>.</li>
      <li style="margin-bottom:4px;">It logs leads, tasks, goals, and follow-ups straight into your dashboard.</li>
      <li style="margin-bottom:4px;">Voice notes work too — talk while you drive, it transcribes and files everything.</li>
      <li>Morning briefing, midday pulse, and reminders for anything overdue or heating up — all on Telegram.</li>
    </ul>

    <p style="margin:24px 0 0;">Reply to this email if anything's off. We're around.</p>
    <p style="margin:8px 0 0;color:${BRAND_RED};font-weight:700;">— The Virtual Closer team</p>
  `

  return {
    subject: `Welcome to Virtual Closer, ${input.displayName.split(' ')[0] || input.displayName}`,
    html: shell({
      title: 'Your workspace is live',
      preheader: `Sign in at ${dashboardUrl} and link your Telegram with code ${code}.`,
      body,
    }),
    text: [
      `Hey ${input.displayName},`,
      ``,
      `Your ${input.tierLabel} workspace is live.`,
      ``,
      `1. Sign in`,
      `   ${loginUrl}`,
      `   Email:    ${input.toEmail}`,
      `   Password: ${input.password}`,
      `   Workspace: ${input.slug}.${ROOT_DOMAIN}`,
      ``,
      `2. Connect Telegram`,
      `   Message ${botUrl}, tap Start, then send:`,
      `   /link ${code}`,
      ``,
      `Then text it like an assistant — "call Dana Thursday about pricing", "goal: 10 deals this month" — and watch your dashboard update.`,
      ``,
      `— Virtual Closer`,
    ].join('\n'),
  }
}

// ── Password change confirmation ──────────────────────────────────────────

export function passwordChangedEmail(input: { toEmail: string; displayName: string }) {
  const loginUrl = `https://${ROOT_DOMAIN}/login`
  const body = `
    <p style="margin:0 0 14px;">Hey ${escape(input.displayName.split(' ')[0] || input.displayName)},</p>
    <p style="margin:0 0 14px;">Your Virtual Closer password was just changed.</p>
    <p style="margin:0 0 14px;">If this was you, you can ignore this email. If it wasn't, reply to this message immediately so we can lock the account.</p>
    <p style="margin:18px 0 0;"><a href="${loginUrl}" style="color:${BRAND_RED};font-weight:700;">Sign in →</a></p>
  `
  return {
    subject: 'Your Virtual Closer password was changed',
    html: shell({ title: 'Password updated', preheader: 'Your Virtual Closer password was just changed.', body }),
    text: `Hey ${input.displayName},\n\nYour Virtual Closer password was just changed. If this wasn't you, reply to this email immediately.\n\n— Virtual Closer`,
  }
}

// ── Password reset ───────────────────────────────────────────────────────

export function passwordResetEmail(input: { toEmail: string; displayName: string; resetUrl: string }) {
  const body = `
    <p style="margin:0 0 14px;">Hey ${escape(input.displayName.split(' ')[0] || input.displayName)},</p>
    <p style="margin:0 0 14px;">We got a request to reset the password for your Virtual Closer account. Click the button below — the link expires in 1 hour.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr><td bgcolor="${BRAND_RED}" style="border-radius:10px;">
        <a href="${input.resetUrl}" style="display:inline-block;padding:12px 24px;background:${BRAND_RED};color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;border-radius:10px;letter-spacing:0.04em;text-transform:uppercase;">Reset password →</a>
      </td></tr>
    </table>
    <p style="margin:0 0 14px;font-size:13px;color:${BRAND_MUTED};">If you didn't request this, you can safely ignore this email — your password won't change.</p>
    <p style="margin:0;font-size:12px;color:${BRAND_MUTED};">Or copy this link: <a href="${input.resetUrl}" style="color:${BRAND_RED};word-break:break-all;">${input.resetUrl}</a></p>
  `
  return {
    subject: 'Reset your Virtual Closer password',
    html: shell({ title: 'Reset your password', preheader: 'Click to set a new password. Link expires in 1 hour.', body }),
    text: `Hey ${input.displayName},\n\nReset your Virtual Closer password:\n${input.resetUrl}\n\nLink expires in 1 hour. If you didn't request this, ignore this email.\n\n— Virtual Closer`,
  }
}

// ── Admin booking notification ────────────────────────────────────────────

export type BookingNotificationInput = {
  triggerEvent: string // e.g. BOOKING_CREATED / BOOKING_RESCHEDULED / BOOKING_CANCELLED
  name: string | null
  email: string | null
  company: string | null
  phone: string | null
  tier: string | null
  notes: string | null
  meetingAt: string | null // ISO
  timezone: string | null
  bookingUrl: string | null
  prospectId: string | null
}

function fmtMeeting(iso: string | null, tz: string | null): string {
  if (!iso) return 'TBD'
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz || 'UTC',
      timeZoneName: 'short',
    })
  } catch {
    return iso
  }
}

function eventLabel(trigger: string): { headline: string; pill: string; pillBg: string } {
  const t = trigger.toUpperCase()
  if (t.includes('CANCEL')) return { headline: 'Booking canceled', pill: 'CANCELED', pillBg: BRAND_INK }
  if (t.includes('RESCHEDULED')) return { headline: 'Booking rescheduled', pill: 'RESCHEDULED', pillBg: '#b35a00' }
  return { headline: 'New kickoff call booked', pill: 'NEW BOOKING', pillBg: BRAND_RED }
}

export function bookingNotificationEmail(input: BookingNotificationInput) {
  const lbl = eventLabel(input.triggerEvent)
  const when = fmtMeeting(input.meetingAt, input.timezone)
  const adminProspectUrl = input.prospectId
    ? `https://${ROOT_DOMAIN}/admin/prospects`
    : null

  const row = (label: string, value: string | null) =>
    value
      ? `<tr><td style="padding:6px 0;font-size:13px;color:${BRAND_MUTED};width:110px;vertical-align:top;">${escape(label)}</td><td style="padding:6px 0;font-size:14px;color:${BRAND_INK};font-weight:600;">${escape(value)}</td></tr>`
      : ''

  const body = `
    <p style="margin:0 0 14px;display:inline-block;background:${lbl.pillBg};color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:5px 10px;border-radius:999px;">${lbl.pill}</p>
    <p style="margin:0 0 18px;font-size:15px;color:${BRAND_INK};">
      ${escape(input.name ?? 'Someone')} just ${lbl.pill === 'NEW BOOKING' ? 'booked a kickoff call' : lbl.pill === 'RESCHEDULED' ? 'rescheduled their kickoff call' : 'canceled their kickoff call'}.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" style="background:${BRAND_PAPER_2};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:14px 18px;width:100%;">
      ${row('Name', input.name)}
      ${row('Email', input.email)}
      ${row('Company', input.company)}
      ${row('Phone', input.phone)}
      ${row('Tier', input.tier)}
      ${row('When', when)}
      ${row('Timezone', input.timezone)}
    </table>

    ${
      input.notes
        ? `<h2 style="margin:22px 0 8px;font-size:14px;color:${BRAND_RED};text-transform:uppercase;letter-spacing:0.1em;">Notes</h2>
           <p style="margin:0;padding:12px 14px;background:${BRAND_PAPER_2};border:1px solid ${BRAND_BORDER};border-radius:10px;font-size:14px;line-height:1.55;color:${BRAND_INK};white-space:pre-wrap;">${escape(input.notes)}</p>`
        : ''
    }

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;">
      <tr>
        ${
          adminProspectUrl
            ? `<td bgcolor="${BRAND_RED}" style="border-radius:10px;">
                <a href="${adminProspectUrl}" style="display:inline-block;padding:11px 20px;background:${BRAND_RED};color:#ffffff;font-weight:700;font-size:13px;text-decoration:none;border-radius:10px;letter-spacing:0.04em;">Open prospect →</a>
              </td>`
            : ''
        }
        ${
          input.bookingUrl
            ? `<td style="padding-left:8px;">
                <a href="${input.bookingUrl}" style="display:inline-block;padding:11px 20px;background:${BRAND_PAPER};color:${BRAND_INK};font-weight:700;font-size:13px;text-decoration:none;border-radius:10px;border:1px solid ${BRAND_INK};">View on Cal.com</a>
              </td>`
            : ''
        }
      </tr>
    </table>
  `

  const subject =
    lbl.pill === 'NEW BOOKING'
      ? `📅 New kickoff: ${input.name ?? 'Unknown'}${input.tier ? ` (${input.tier})` : ''}`
      : lbl.pill === 'RESCHEDULED'
        ? `🔁 Rescheduled: ${input.name ?? 'Unknown'}`
        : `✕ Canceled: ${input.name ?? 'Unknown'}`

  return {
    subject,
    html: shell({
      title: lbl.headline,
      preheader: `${input.name ?? 'Someone'} · ${when}${input.tier ? ` · ${input.tier}` : ''}`,
      body,
    }),
    text: [
      lbl.headline,
      ``,
      `Name:    ${input.name ?? '-'}`,
      `Email:   ${input.email ?? '-'}`,
      input.company ? `Company: ${input.company}` : null,
      input.phone ? `Phone:   ${input.phone}` : null,
      input.tier ? `Tier:    ${input.tier}` : null,
      `When:    ${when}`,
      input.timezone ? `TZ:      ${input.timezone}` : null,
      input.notes ? `\nNotes:\n${input.notes}` : null,
      input.bookingUrl ? `\nCal: ${input.bookingUrl}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

// ── Member invite email ───────────────────────────────────────────────────

export type MemberInviteInput = {
  toEmail: string
  displayName: string
  role: 'owner' | 'admin' | 'manager' | 'rep' | 'observer'
  workspaceLabel: string  // e.g. "Acme Sales" or company display name
  slug: string            // tenant slug (subdomain)
  password: string        // plaintext, only used here once
  invitedByName: string | null
  telegramLinkCode: string | null
  telegramBotUsername: string
}

const ROLE_BLURB: Record<MemberInviteInput['role'], string> = {
  owner: 'You have full access — billing, members, and all data.',
  admin: 'You have full access except billing.',
  manager: "You can see the whole account and edit your team's data.",
  rep: 'You manage your own leads, calls, and goals.',
  observer: 'You have read-only access across the account.',
}

export function memberInviteEmail(input: MemberInviteInput) {
  const loginUrl = `https://${ROOT_DOMAIN}/login`
  const dashUrl = `https://${input.slug}.${ROOT_DOMAIN}/dashboard`
  const botUrl = `https://t.me/${input.telegramBotUsername}`
  const code = input.telegramLinkCode ?? ''
  const inviter = input.invitedByName?.trim()

  const body = `
    <p style="margin:0 0 14px;">Hey ${escape(input.displayName.split(' ')[0] || input.displayName)},</p>
    <p style="margin:0 0 16px;">${inviter ? `${escape(inviter)} added you` : 'You\'ve been added'} to <strong>${escape(input.workspaceLabel)}</strong> on Virtual Closer as <strong>${escape(input.role)}</strong>.</p>
    <p style="margin:0 0 22px;color:${BRAND_MUTED};font-size:14px;">${escape(ROLE_BLURB[input.role])}</p>

    <h2 style="margin:24px 0 10px;font-size:16px;color:${BRAND_RED};">1. Sign in</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" style="background:${BRAND_PAPER_2};border:1px solid ${BRAND_BORDER};border-radius:10px;padding:14px 18px;font-size:14px;width:100%;">
      <tr><td style="padding:3px 0;"><strong style="color:${BRAND_RED};">Email:</strong> &nbsp;${escape(input.toEmail)}</td></tr>
      <tr><td style="padding:3px 0;"><strong style="color:${BRAND_RED};">Password:</strong> &nbsp;<code style="font-family:'SF Mono',Menlo,monospace;font-size:14px;background:${BRAND_PAPER};padding:2px 6px;border-radius:4px;border:1px solid ${BRAND_BORDER};">${escape(input.password)}</code></td></tr>
      <tr><td style="padding:3px 0;"><strong style="color:${BRAND_RED};">Workspace:</strong> &nbsp;${escape(input.slug)}.${escape(ROOT_DOMAIN)}</td></tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;">
      <tr><td bgcolor="${BRAND_RED}" style="border-radius:10px;">
        <a href="${loginUrl}" style="display:inline-block;padding:12px 22px;background:${BRAND_RED};color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;border-radius:10px;letter-spacing:0.04em;text-transform:uppercase;">Sign in →</a>
      </td></tr>
    </table>
    <p style="margin:6px 0 0;font-size:12px;color:${BRAND_MUTED};">You can change your password from the dashboard once you're in.</p>

    ${
      code
        ? `<h2 style="margin:30px 0 10px;font-size:16px;color:${BRAND_RED};">2. Connect your Telegram assistant</h2>
           <p style="margin:0 0 10px;">Your assistant lives on Telegram — text or voice-note it like a real person, and your dashboard updates automatically.</p>
           <ol style="margin:0 0 14px;padding-left:20px;">
             <li style="margin-bottom:6px;">Message <a href="${botUrl}" style="color:${BRAND_RED};font-weight:600;">@${escape(input.telegramBotUsername)}</a> on Telegram and tap <strong>Start</strong>.</li>
             <li style="margin-bottom:6px;">Send this exact message:<br>
               <code style="display:inline-block;background:${BRAND_PAPER_2};border:1px solid ${BRAND_BORDER};padding:6px 12px;border-radius:6px;margin-top:6px;font-family:'SF Mono',Menlo,monospace;font-size:14px;">/link ${escape(code)}</code>
             </li>
             <li>You'll get a confirmation. That's it.</li>
           </ol>`
        : ''
    }

    <p style="margin:24px 0 0;">Reply to this email if anything's off.</p>
    <p style="margin:8px 0 0;color:${BRAND_RED};font-weight:700;">— Virtual Closer</p>
  `

  return {
    subject: `You're invited to ${input.workspaceLabel} on Virtual Closer`,
    html: shell({
      title: `You're in${inviter ? ` — ${inviter} added you` : ''}`,
      preheader: `Sign in at ${dashUrl} as ${input.role}.`,
      body,
    }),
    text: [
      `Hey ${input.displayName},`,
      ``,
      inviter
        ? `${inviter} added you to ${input.workspaceLabel} on Virtual Closer as ${input.role}.`
        : `You've been added to ${input.workspaceLabel} on Virtual Closer as ${input.role}.`,
      ROLE_BLURB[input.role],
      ``,
      `1. Sign in`,
      `   ${loginUrl}`,
      `   Email:    ${input.toEmail}`,
      `   Password: ${input.password}`,
      `   Workspace: ${input.slug}.${ROOT_DOMAIN}`,
      ``,
      ...(code
        ? [
            `2. Connect Telegram`,
            `   Message ${botUrl}, tap Start, then send:`,
            `   /link ${code}`,
            ``,
          ]
        : []),
      `— Virtual Closer`,
    ].join('\n'),
  }
}

// ── Random password generator (admin convenience) ─────────────────────────

/**
 * Generates a memorable-but-strong 14-char password: lowercase letters + digits,
 * with a couple of dashes for readability. e.g. "qovax-7n3kp-2bd"
 * Avoids ambiguous chars (0/O, 1/l/I).
 */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789' // no 0,o,1,i,l
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  return `${pick(5)}-${pick(5)}-${pick(3)}`
}
