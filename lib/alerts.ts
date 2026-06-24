// Operator alerts — immediate push when something is breaking, so the team
// hears about it before users report it. Distinct from the once-a-day fix
// digest: this fires NOW on the things that can't wait (worker down, fatal
// error, high-severity issue report).
//
// Channel: email via Resend to ALERT_EMAIL (falls back to FIX_DIGEST_EMAIL,
// then jace@virtualcloser.com). Structured so a Telegram/SMS channel can be
// added later without touching call sites.
//
// Designed to NEVER throw — alerting must not cascade into the caller's path.
// A per-key in-memory cooldown prevents alert storms from a tight failure loop
// (effective in the long-lived Hetzner worker; serverless invocations are
// short-lived so cooldown there is best-effort, which is fine — the call sites
// that fire from serverless are rare events).

import { sendEmail } from '@/lib/email'

const ALERT_TO =
  process.env.ALERT_EMAIL || process.env.FIX_DIGEST_EMAIL || 'jace@virtualcloser.com'
const COOLDOWN_MS = parseInt(process.env.ALERT_COOLDOWN_MS ?? '600000', 10) // 10 min

const lastFired = new Map<string, number>()

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export type AlertInput = {
  /** Dedupe key — repeated alerts with the same key inside the cooldown are dropped. Defaults to title. */
  key?: string
  severity?: 'warn' | 'error' | 'fatal'
  title: string
  body: string
  context?: Record<string, unknown>
}

export async function alertOperator(input: AlertInput): Promise<void> {
  try {
    const key = input.key ?? input.title
    const now = Date.now()
    const prev = lastFired.get(key) ?? 0
    if (now - prev < COOLDOWN_MS) return
    lastFired.set(key, now)

    const sev = (input.severity ?? 'error').toUpperCase()
    const subject = `[VirtualCloser ALERT] ${sev} — ${input.title}`.slice(0, 180)
    const ctxStr =
      input.context && Object.keys(input.context).length > 0
        ? `\n\nContext:\n${JSON.stringify(input.context, null, 2)}`
        : ''
    const text = `${input.body}${ctxStr}`
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;">
<h2 style="color:#c0392b;font-size:18px;margin:0 0 8px;">${sev} — ${esc(input.title)}</h2>
<pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.5;background:#f7f7f5;border-radius:8px;padding:12px;">${esc(text)}</pre>
<p style="color:#999;font-size:12px;margin-top:16px;">Real-time operator alert · VirtualCloser diagnostics</p>
</div>`

    await sendEmail({ to: ALERT_TO, subject, html, text })
  } catch (err) {
    console.error('[alerts] failed to send', err instanceof Error ? err.message : String(err))
  }
}
