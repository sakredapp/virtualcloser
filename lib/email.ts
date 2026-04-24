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
