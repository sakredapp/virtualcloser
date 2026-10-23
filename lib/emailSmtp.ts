/**
 * Outbound mail through the client's own mailbox, for the self-hosted Suite CXO
 * box (selfhost/). A box has no Resend or SES: it sends through the SMTP server
 * the client already uses (Microsoft 365, Google Workspace, their own relay).
 *
 * Only `sendEmail` in lib/email.ts calls this. It is used only when the app runs
 * on a box (`SELFHOST=1`) and `SMTP_HOST` is set, so a stray SMTP_HOST on Vercel
 * can never divert cloud mail.
 *
 * Env (all in the box's selfhost/.env, values on the client's build sheet):
 *   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS
 *   SMTP_SECURE     "true" for implicit TLS (port 465); default STARTTLS when offered
 *   SMTP_FROM       `Name <addr>` on the client's own domain; default `Suite CXO <SMTP_USER>`
 *   SMTP_REPLY_TO   where replies go; default the From address
 */
import type { Transporter } from 'nodemailer'
import type { EmailAttachment } from './email'

export type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
  replyTo: string
}

/** The box's SMTP settings, or null when mail should not go through SMTP. */
export function smtpConfig(env: Record<string, string | undefined> = process.env, fallbackName = 'Suite CXO'): SmtpConfig | null {
  if (env.SELFHOST !== '1') return null
  const host = env.SMTP_HOST?.trim()
  if (!host) return null
  const port = parseInt(env.SMTP_PORT?.trim() || '587', 10)
  const user = env.SMTP_USER?.trim() || undefined
  const pass = env.SMTP_PASS || undefined
  const from = env.SMTP_FROM?.trim() || (user && user.includes('@') ? `${fallbackName} <${user}>` : `${fallbackName} <noreply@${host}>`)
  const fromAddr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim()
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: env.SMTP_SECURE?.trim().toLowerCase() === 'true' || port === 465,
    user,
    pass,
    from,
    replyTo: env.SMTP_REPLY_TO?.trim() || fromAddr,
  }
}

// nodemailer is loaded only when a box sends: lib/email.ts is reachable from
// instrumentation.ts, which Next also compiles for the edge runtime, where
// nodemailer's node:stream/fs imports cannot resolve. webpackIgnore keeps it out
// of every bundle; the standalone file trace still ships it on the box.
async function loadNodemailer(): Promise<typeof import('nodemailer')> {
  const mod = await import(/* webpackIgnore: true */ 'nodemailer')
  return (mod as { default?: typeof import('nodemailer') }).default ?? mod
}

let _transport: { key: string; t: Transporter } | null = null
async function transport(cfg: SmtpConfig): Promise<Transporter> {
  const key = `${cfg.host}:${cfg.port}:${cfg.secure}:${cfg.user ?? ''}`
  if (_transport?.key !== key) {
    const nodemailer = await loadNodemailer()
    _transport = {
      key,
      t: nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      }),
    }
  }
  return _transport.t
}

export async function sendViaSmtp(
  cfg: SmtpConfig,
  input: { to: string; subject: string; html: string; text?: string; replyTo?: string; attachments?: EmailAttachment[] },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const info = await (await transport(cfg)).sendMail({
      from: cfg.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo ?? cfg.replyTo,
      attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    })
    return { ok: true, id: info.messageId }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[email] smtp send failed', { host: cfg.host, error: message })
    return { ok: false, error: message }
  }
}
