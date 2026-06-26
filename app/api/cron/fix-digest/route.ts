// Daily "what to fix" digest — emails the developer everything that needs a
// human code change, in full, untruncated form so it can be pasted straight
// into the editor and fixed.
//
// Four streams (last 24h, except fix-requests which drain until sent):
//   1. Fix-requests        — the "request a change" box + auto-routed feedback
//   2. Agent action failures — plaud_actions that failed to execute
//   3. App errors          — runtime errors/diagnostics (app_errors)
//   4. What the AI learned  — new plaud_agent_guidance rules that day
//
// Recipient: FIX_DIGEST_EMAIL (defaults to jace@virtualcloser.com).

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { supabase } from '@/lib/supabase'
import { logError } from '@/lib/errors'
import { sendEmail } from '@/lib/email'
import { listNewFixRequests, markFixRequestsSent, type FixRequest } from '@/lib/feedback/fixRequests'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RECIPIENT = process.env.FIX_DIGEST_EMAIL || 'jace@virtualcloser.com'
const WINDOW_HOURS = 24

type FailedAction = {
  kind: string
  target_email: string | null
  error: string | null
  reasoning: string | null
  rep_id: string | null
  updated_at: string
}
type AppError = {
  occurred_at: string
  severity: string
  source: string | null
  error_type: string | null
  message: string | null
  context: Record<string, unknown> | null
}
type LearnedRule = {
  rule: string
  kind: string
  scope: string
  source: string
  created_at: string
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString()

  const [fixRequests, failedRes, errorsRes, learnedRes] = await Promise.all([
    listNewFixRequests(),
    supabase
      .from('plaud_actions')
      .select('kind, target_email, error, reasoning, rep_id, updated_at')
      .eq('status', 'failed')
      .gte('updated_at', sinceIso)
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase
      .from('app_errors')
      .select('occurred_at, severity, source, error_type, message, context')
      .gte('occurred_at', sinceIso)
      .in('severity', ['warn', 'error', 'fatal'])
      .order('occurred_at', { ascending: false })
      .limit(300),
    supabase
      .from('plaud_agent_guidance')
      .select('rule, kind, scope, source, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const failed = (failedRes.data ?? []) as FailedAction[]
  const errors = (errorsRes.data ?? []) as AppError[]
  const learned = (learnedRes.data ?? []) as LearnedRule[]

  const total = fixRequests.length + failed.length + errors.length + learned.length
  if (total === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'nothing to report' })
  }

  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })
  const subject = `[VirtualCloser] Daily fix digest — ${today} (${fixRequests.length} requests, ${failed.length} agent fails, ${errors.length} errors)`

  const { text, html } = render({ today, fixRequests, failed, errors, learned })

  const res = await sendEmail({ to: RECIPIENT, subject, html, text })
  if (!res.ok) {
    await logError({
      source: 'cron/fix-digest',
      errorType: 'digest_send_failed',
      message: res.error ?? 'send failed',
      context: { to: RECIPIENT, counts: { fixRequests: fixRequests.length, failed: failed.length, errors: errors.length, learned: learned.length } },
    })
    return NextResponse.json({ ok: false, error: res.error ?? 'send failed' }, { status: 500 })
  }

  // Only mark fix-requests sent once the email actually went out, so a failed
  // send doesn't silently drop them — they roll into tomorrow's digest.
  await markFixRequestsSent(fixRequests.map((f) => f.id))

  return NextResponse.json({
    ok: true,
    sent: true,
    to: RECIPIENT,
    counts: { fixRequests: fixRequests.length, failed: failed.length, errors: errors.length, learned: learned.length },
  })
}

function render(input: {
  today: string
  fixRequests: FixRequest[]
  failed: FailedAction[]
  errors: AppError[]
  learned: LearnedRule[]
}): { text: string; html: string } {
  const { today, fixRequests, failed, errors, learned } = input
  const t: string[] = []
  const h: string[] = []

  h.push(`<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;color:#1a1a1a;">`)
  h.push(`<h1 style="font-size:20px;margin:0 0 4px;">VirtualCloser — Daily fix digest</h1>`)
  h.push(`<p style="color:#666;font-size:13px;margin:0 0 20px;">${esc(today)} · everything below needs a code change or a look.</p>`)
  t.push(`VirtualCloser — Daily fix digest`)
  t.push(`${today}\n`)

  // 1. Fix-requests
  t.push(`\n=== FIX REQUESTS / PRODUCT FEEDBACK (${fixRequests.length}) ===`)
  h.push(`<h2 style="font-size:15px;border-bottom:2px solid #eee;padding-bottom:4px;">① Fix requests / product feedback (${fixRequests.length})</h2>`)
  if (fixRequests.length === 0) {
    t.push('  (none)')
    h.push(`<p style="color:#999;font-size:13px;">None.</p>`)
  } else {
    for (const f of fixRequests) {
      const who = f.created_by ? ` — ${f.created_by}` : ''
      const sev = f.severity !== 'normal' ? ` [${f.severity.toUpperCase()}]` : ''
      const meta = `${f.source}${who}${f.area ? ` · ${f.area}` : ''} · ${fmt(f.created_at)}${sev}`
      // Paste-ready prompt for Claude Code — just copy this line.
      const page = (f.area ?? '').replace(/^page:/, '').replace(/^\//, '') || 'the app'
      const prompt = `Fix this feedback from ${f.created_by || 'a user'} on ${page}: "${f.body.replace(/\s+/g, ' ').trim()}"`
      t.push(`\n• ${meta}\n${f.body}\n  ▶ PASTE TO CLAUDE CODE: ${prompt}`)
      h.push(`<div style="margin:0 0 14px;padding:10px 12px;background:#f7f7f5;border-radius:8px;">`)
      h.push(`<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">${esc(meta)}</div>`)
      h.push(`<pre style="margin:0 0 8px;white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.5;">${esc(f.body)}</pre>`)
      h.push(`<div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px;">Paste to Claude Code</div>`)
      h.push(`<pre style="margin:0;white-space:pre-wrap;font-family:'SF Mono',Menlo,monospace;font-size:12px;line-height:1.5;background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:8px 10px;color:#333;">${esc(prompt)}</pre>`)
      h.push(`</div>`)
    }
  }

  // 2. Agent action failures
  t.push(`\n\n=== AGENT ACTION FAILURES (${failed.length}) ===`)
  h.push(`<h2 style="font-size:15px;border-bottom:2px solid #eee;padding-bottom:4px;margin-top:24px;">② Agent action failures (${failed.length})</h2>`)
  if (failed.length === 0) {
    t.push('  (none)')
    h.push(`<p style="color:#999;font-size:13px;">None.</p>`)
  } else {
    for (const a of failed) {
      const line = `${a.kind}${a.target_email ? ` → ${a.target_email}` : ''} · ${fmt(a.updated_at)}`
      t.push(`\n• ${line}\n  error: ${a.error ?? '(none)'}${a.reasoning ? `\n  reason: ${a.reasoning}` : ''}`)
      h.push(`<div style="margin:0 0 10px;font-size:13px;line-height:1.5;">`)
      h.push(`<strong>${esc(line)}</strong><br/><span style="color:#c0392b;">${esc(a.error ?? '(no error text)')}</span>`)
      h.push(`</div>`)
    }
  }

  // 3. App errors
  t.push(`\n\n=== APP ERRORS / DIAGNOSTICS (${errors.length}) ===`)
  h.push(`<h2 style="font-size:15px;border-bottom:2px solid #eee;padding-bottom:4px;margin-top:24px;">③ App errors / diagnostics (${errors.length})</h2>`)
  if (errors.length === 0) {
    t.push('  (none)')
    h.push(`<p style="color:#999;font-size:13px;">None.</p>`)
  } else {
    for (const e of errors) {
      const line = `[${e.severity}] ${e.source ?? '?'} · ${e.error_type ?? 'error'} · ${fmt(e.occurred_at)}`
      const ctx = e.context && Object.keys(e.context).length > 0 ? `\n  context: ${JSON.stringify(e.context)}` : ''
      t.push(`\n• ${line}\n  ${e.message ?? '(no message)'}${ctx}`)
      h.push(`<div style="margin:0 0 10px;font-size:13px;line-height:1.5;">`)
      h.push(`<strong>${esc(line)}</strong><br/>${esc(e.message ?? '(no message)')}`)
      h.push(`</div>`)
    }
  }

  // 4. What the AI learned
  t.push(`\n\n=== WHAT THE AI LEARNED (${learned.length}) ===`)
  h.push(`<h2 style="font-size:15px;border-bottom:2px solid #eee;padding-bottom:4px;margin-top:24px;">④ What the AI learned (${learned.length})</h2>`)
  if (learned.length === 0) {
    t.push('  (none)')
    h.push(`<p style="color:#999;font-size:13px;">None.</p>`)
  } else {
    for (const l of learned) {
      t.push(`\n• [${l.kind}/${l.scope}] ${l.rule}`)
      h.push(`<div style="margin:0 0 6px;font-size:13px;"><span style="color:#888;">[${esc(l.kind)}/${esc(l.scope)}]</span> ${esc(l.rule)}</div>`)
    }
  }

  h.push(`<p style="color:#999;font-size:12px;margin-top:28px;border-top:1px solid #eee;padding-top:12px;">Auto-generated daily. Fix-requests are marked sent once this email goes out.</p>`)
  h.push(`</div>`)

  return { text: t.join('\n'), html: h.join('\n') }
}
