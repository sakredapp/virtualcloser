// POST /api/webhooks/fathom-prospect
//
// Fathom webhook for PROSPECT calls (sales demos, discovery, kickoffs)
// — NOT to be confused with /api/webhooks/fathom which logs calls into
// an existing rep tenant. This one matches an attendee email to a row in
// the `prospects` table and triggers a Claude-generated build plan.
//
// Auth: shared secret in ?token= or X-Webhook-Token header. Set
// FATHOM_PROSPECT_WEBHOOK_TOKEN in Vercel env.

import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  normalizeFathomPayload,
  pickProspectAttendee,
  verifyFathomRequest,
  fetchTranscriptById,
  type FathomMeeting,
} from '@/lib/fathom'
import { generateBuildPlanFromMeeting } from '@/lib/buildPlan'
import { autoAdvanceStage } from '@/lib/pipeline'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export async function POST(req: NextRequest) {
  // Read raw body first — needed for HMAC signature verification.
  const rawBody = await req.text()

  const verification = verifyFathomRequest({
    rawBody,
    headers: req.headers,
    url: req.url,
    secret: process.env.FATHOM_WEBHOOK_SECRET,
    expectedToken: process.env.FATHOM_PROSPECT_WEBHOOK_TOKEN,
  })
  // Auth is REQUIRED in every environment. Fail-open here would let any
  // caller create brain_items and trigger admin emails via unverified
  // payloads. The earlier dev-only acceptance branch was a footgun.
  const authConfigured = !!process.env.FATHOM_WEBHOOK_SECRET || !!process.env.FATHOM_PROSPECT_WEBHOOK_TOKEN
  if (!authConfigured) {
    console.error('[fathom-prospect] no webhook auth configured — rejecting')
    return NextResponse.json({ ok: false, reason: 'webhook_not_configured' }, { status: 503 })
  }
  if (!verification.valid) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 })
  }

  const meeting = normalizeFathomPayload(raw)
  if (!meeting) {
    return NextResponse.json({ ok: false, reason: 'bad_payload' }, { status: 400 })
  }

  // If the webhook didn't include the full transcript, pull it via the
  // API. Fathom often sends a meeting reference + summary first, with the
  // transcript fetchable via REST.
  if (!meeting.transcript && meeting.id) {
    const fetched = await fetchTranscriptById(meeting.id)
    if (fetched) meeting.transcript = fetched
  }

  const attendee = pickProspectAttendee(meeting)
  if (!attendee) {
    return NextResponse.json({ ok: true, ignored: 'no_external_attendee' })
  }

  // Find or create prospect by email.
  const { data: existing } = await supabase
    .from('prospects')
    .select('id, email, status, rep_id, payload')
    .ilike('email', attendee.email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let prospectId: string
  let isNew = false
  if (existing?.id) {
    prospectId = existing.id as string
  } else {
    isNew = true
    const { data: created, error } = await supabase
      .from('prospects')
      .insert({
        source: 'fathom',
        external_id: meeting.id,
        name: attendee.name,
        email: attendee.email,
        status: 'contacted',
        meeting_at: meeting.startedAt ?? null,
        notes: `Auto-created from Fathom recording ${meeting.id}.`,
        payload: { fathom_meeting: meeting } as Record<string, unknown>,
      })
      .select('id')
      .single()
    if (error) {
      console.error('[fathom-prospect] insert failed', error)
      return NextResponse.json({ ok: false, reason: 'prospect_insert_failed' }, { status: 500 })
    }
    prospectId = created.id as string
  }

  // Plan generation calls Claude and can take 30-90 seconds. Webhook senders
  // (Fathom) treat slow responses as failures and retry, creating duplicate
  // prospects. Return 200 immediately and finish the work in the background
  // via Next.js `after()` (the function instance is kept alive by Vercel
  // until the callback completes — no fire-and-forget orphaning).
  const prevPayload = (existing?.payload as Record<string, unknown> | null) ?? {}
  after(async () => {
    try {
      const plan = await generateBuildPlanFromMeeting(meeting)

      await supabase
        .from('prospects')
        .update({
          build_summary: plan?.summary ?? meeting.summary ?? null,
          build_brief: plan?.brief ?? null,
          build_plan: plan?.plan ?? null,
          build_cost_estimate: plan?.cost_estimate_usd ?? null,
          maintenance_estimate: plan?.cost_estimate_usd ?? null,
          selected_features: plan?.selected_features ?? [],
          plan_generated_at: plan ? new Date().toISOString() : null,
          payload: {
            ...prevPayload,
            fathom_meeting: meeting,
            last_plan_open_questions: plan?.open_questions ?? [],
          } as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        })
        .eq('id', prospectId)

      if (plan) {
        await autoAdvanceStage({ prospectId, targetStage: 'plan_generated' }).catch(() => {})
      }

      if (process.env.ADMIN_NOTIFY_EMAIL && plan) {
        await sendEmail({
          to: process.env.ADMIN_NOTIFY_EMAIL,
          subject: `[Build plan] ${attendee.name ?? attendee.email} — ${plan.summary.slice(0, 80)}`,
          html: emailHtml({ meeting, attendee, plan, prospectId, isNew }),
          text: planTextDigest({ attendee, plan, prospectId, isNew }),
        }).catch((err) => console.error('[fathom-prospect] admin notify email failed', err))
      }
    } catch (err) {
      console.error('[fathom-prospect] background plan generation failed', err)
    }
  })

  return NextResponse.json({
    ok: true,
    prospectId,
    isNew,
    planGenerated: 'pending', // queued in background; check prospect.plan_generated_at to confirm
    meetingId: meeting.id,
  })
}

function emailHtml(args: {
  meeting: FathomMeeting
  attendee: { email: string; name: string | null }
  plan: NonNullable<Awaited<ReturnType<typeof generateBuildPlanFromMeeting>>>
  prospectId: string
  isNew: boolean
}): string {
  const reviewUrl = `https://${ROOT}/admin/prospects/${args.prospectId}`
  return `
    <p>${args.isNew ? 'New' : 'Updated'} build plan for <strong>${escapeHtml(args.attendee.name ?? args.attendee.email)}</strong>${args.attendee.email ? ` &lt;${escapeHtml(args.attendee.email)}&gt;` : ''}.</p>
    <p><strong>Summary:</strong> ${escapeHtml(args.plan.summary)}</p>
    <p><strong>Estimated monthly:</strong> ${args.plan.cost_estimate_usd ? `$${args.plan.cost_estimate_usd}` : '—'} ·
       <strong>Setup fee:</strong> ${args.plan.setup_fee_estimate_usd ? `$${args.plan.setup_fee_estimate_usd}` : '—'}</p>
    <p><strong>Features:</strong> ${args.plan.selected_features.join(', ') || 'none flagged'}</p>
    ${args.plan.open_questions.length > 0 ? `<p><strong>Open questions:</strong></p><ul>${args.plan.open_questions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}</ul>` : ''}
    <p><a href="${reviewUrl}">Review in admin →</a></p>
  `
}

function planTextDigest(args: {
  attendee: { email: string; name: string | null }
  plan: NonNullable<Awaited<ReturnType<typeof generateBuildPlanFromMeeting>>>
  prospectId: string
  isNew: boolean
}): string {
  return [
    `${args.isNew ? 'New' : 'Updated'} build plan for ${args.attendee.name ?? args.attendee.email}`,
    `Summary: ${args.plan.summary}`,
    `Monthly: ${args.plan.cost_estimate_usd ?? '—'} · Setup: ${args.plan.setup_fee_estimate_usd ?? '—'}`,
    `Features: ${args.plan.selected_features.join(', ')}`,
    args.plan.open_questions.length > 0
      ? `Open questions:\n- ${args.plan.open_questions.join('\n- ')}`
      : '',
    `Review: https://${ROOT}/admin/prospects/${args.prospectId}`,
  ].filter(Boolean).join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
