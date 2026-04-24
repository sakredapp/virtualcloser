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

function shell(opts: { title: string; preheader?: string; body: string }): string {
  const royal = '#1e3a8a'
  const ink = '#0b1f5c'
  const cream = '#faf3df'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escape(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${ink};">
${opts.preheader ? `<span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${escape(opts.preheader)}</span>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${cream};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid rgba(30,58,138,0.12);border-radius:14px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${royal};font-weight:600;">Virtual Closer</p>
        <h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;color:${ink};">${escape(opts.title)}</h1>
        <div style="font-size:15px;line-height:1.55;color:${ink};">
          ${opts.body}
        </div>
        <p style="margin:32px 0 0;padding-top:20px;border-top:1px solid rgba(30,58,138,0.12);font-size:12px;color:#5a6aa6;">
          Sent by Virtual Closer · <a href="https://${ROOT_DOMAIN}" style="color:${royal};text-decoration:none;">${ROOT_DOMAIN}</a>
        </p>
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
  const royal = '#1e3a8a'
  const dashboardUrl = `https://${input.slug}.${ROOT_DOMAIN}/dashboard`
  const loginUrl = `https://${ROOT_DOMAIN}/login`
  const botUrl = `https://t.me/${input.telegramBotUsername}`
  const code = input.telegramLinkCode ?? ''

  const body = `
    <p style="margin:0 0 16px;">Hey ${escape(input.displayName.split(' ')[0] || input.displayName)},</p>
    <p style="margin:0 0 16px;">Your <strong>${escape(input.tierLabel)}</strong> workspace is live. Here's everything you need to get started.</p>

    <h2 style="margin:24px 0 8px;font-size:16px;color:${royal};">1. Sign in</h2>
    <p style="margin:0 0 8px;">Your private workspace lives at:</p>
    <p style="margin:0 0 12px;"><a href="${dashboardUrl}" style="color:${royal};font-weight:600;">${dashboardUrl}</a></p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="background:#faf3df;border:1px solid rgba(30,58,138,0.12);border-radius:8px;padding:12px 16px;font-size:14px;">
      <tr><td style="padding:2px 0;"><strong>Email:</strong> ${escape(input.toEmail)}</td></tr>
      <tr><td style="padding:2px 0;"><strong>Password:</strong> <code style="font-family:'SF Mono',Menlo,monospace;">${escape(input.password)}</code></td></tr>
    </table>
    <p style="margin:8px 0 0;font-size:13px;color:#5a6aa6;">First sign-in: <a href="${loginUrl}" style="color:${royal};">${loginUrl}</a> — change your password from the dashboard once you're in.</p>

    <h2 style="margin:24px 0 8px;font-size:16px;color:${royal};">2. Connect your Jarvis on Telegram</h2>
    <p style="margin:0 0 8px;">This is the part you'll actually use. Your assistant lives on Telegram — text or voice-note it like you would a real person, and it updates your dashboard automatically.</p>
    <ol style="margin:0 0 12px;padding-left:20px;">
      <li>Open Telegram and message <a href="${botUrl}" style="color:${royal};">@${escape(input.telegramBotUsername)}</a> — tap <strong>Start</strong>.</li>
      <li>Send this exact message:<br><code style="display:inline-block;background:#faf3df;border:1px solid rgba(30,58,138,0.12);padding:4px 10px;border-radius:6px;margin-top:4px;">/link ${escape(code)}</code></li>
      <li>You'll get a confirmation. That's it.</li>
    </ol>

    <h2 style="margin:24px 0 8px;font-size:16px;color:${royal};">3. What happens next</h2>
    <ul style="margin:0 0 16px;padding-left:20px;">
      <li>Talk to it like an assistant: <em>"call Dana Thursday about pricing"</em>, <em>"goal: 10 closed deals this month"</em>.</li>
      <li>It logs leads, tasks, goals, and follow-ups straight into your dashboard.</li>
      <li>You'll get a morning briefing, a midday pulse, and reminders for anything overdue or heating up — all on Telegram.</li>
    </ul>

    <p style="margin:16px 0 0;">Reply to this email if anything's off. We're around.</p>
    <p style="margin:8px 0 0;">— The Virtual Closer team</p>
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
      `   ${dashboardUrl}`,
      `   Email:    ${input.toEmail}`,
      `   Password: ${input.password}`,
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
