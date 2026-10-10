import { NextRequest, NextResponse } from 'next/server'
import {
  createBrainDump,
  createBrainItems,
  getActiveTargets,
  getAllLeads,
  getCallStats,
  getCallsForLead,
  getRecentCalls,
  getRecentLeadNames,
  logCall,
  refreshTargetProgress,
  setTarget,
  supabase,
  upsertLead,
} from '@/lib/supabase'
import {
  generateReport,
  extractBulkLeads,
  generateProjectPlan,
  type MiraIntent,
} from '@/lib/claude'
import { createProjectFromPlan } from '@/lib/projects'
import { runAgent } from '@/lib/agent/runAgent'
import { getBrand } from '@/lib/brand'
import {
  createMemo,
  getMemo,
  listPitchableManagers,
  resolvePitchRecipient,
  setMemoStatus,
} from '@/lib/voice-memos'
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarEventsByQuery,
  findConflict,
  findFreeSlots,
  getMissingSheetFields,
  getSheetCrmConfig,
  listUpcomingEvents,
  mirrorLeadToSheet,
  patchCalendarEvent,
} from '@/lib/google'
import type { Tenant } from '@/lib/tenant'
import { getManagedTeamIds, listMembers, updateMember } from '@/lib/members'
import { isAtLeast } from '@/lib/permissions'
import {
  createRoomMessage,
  getRoomMessage,
  listAudience,
  describeAudience,
} from '@/lib/rooms'
import { BlueBubbles } from '@/lib/bluebubbles'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { createDeferredItem, type DeferredSource } from '@/lib/deferred'
import { mirrorLeadToGHL } from '@/lib/crm-sync'
import {
  createCard as createKpiCard,
  findCard as findKpiCard,
  findAnyCardForMetric,
  listKpiCards,
  logEntry as logKpiEntry,
  normalizeMetric,
  isCurrencyMetric,
  type KpiCard,
} from '@/lib/kpi-cards'
import { sendFeatureRequest } from '@/lib/email'
import type { Lead, LeadStatus, Member } from '@/types'
import { getAppointmentSetterTodaySnapshot } from '@/lib/voice/dialer'

/** The tenant's brand display name (e.g. "Virtual Closer", "CXO Suite"). Used for
 *  user-visible strings like calendar event descriptions so a CXO client never
 *  sees "Virtual Closer" stamped on their events. */
function brandLabel(tenant: Pick<Tenant, 'brand'>): string {
  return getBrand(tenant.brand ?? 'virtualcloser').name
}

/** Fuzzy-match a pipeline stage by name for the given tenant. */
async function findStageByNameForTenant(
  repId: string,
  stageName: string,
): Promise<{ id: string; pipeline_id: string; name: string } | null> {
  const { data } = await supabase
    .from('pipeline_stages')
    .select('id, pipeline_id, name')
    .eq('rep_id', repId)
  if (!data?.length) return null
  const lower = stageName.toLowerCase()
  const rows = data as Array<{ id: string; pipeline_id: string; name: string }>
  return (
    rows.find((s) => s.name.toLowerCase() === lower) ??
    rows.find(
      (s) =>
        s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()),
    ) ??
    null
  )
}

/**
 * Mira's action dispatcher. The agent (lib/agent/runAgent.ts) turns a plain
 * message into structured intents; this runs each one against the CRM and
 * returns a one-line receipt for the reply.
 */

export async function executeIntent(
  intent: MiraIntent,
  tenant: Tenant,
  knownLeads: Lead[],
  brainItemQueue: Array<{
    item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
    content: string
    priority?: 'low' | 'normal' | 'high'
    horizon?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none' | null
    due_date?: string | null
    lead_id?: string | null
  }>,
  ownerMemberId: string | null,
  callerMember: Member,
  rawUserText?: string,
): Promise<string | null> {
  switch (intent.kind) {
    case 'add_lead': {
      const lead = await upsertLead({
        repId: tenant.id,
        name: intent.name,
        company: intent.company ?? null,
        email: intent.email ?? null,
        status: (intent.status as LeadStatus) ?? 'warm',
        notes: intent.note ?? null,
        source: 'mira',
        touchContact: true,
        ownerMemberId,
      })
      const sheetResult = await mirrorLeadToSheet(tenant.id, {
        name: lead.name,
        email: lead.email,
        company: lead.company,
        status: lead.status,
        notes: lead.notes,
        source: 'mira',
        last_contact: lead.last_contact,
      }).catch(() => null)
      const sheetSuffix = sheetResult ? ' · 📄 synced to Google Sheet' : ''

      // Mirror to GHL contact if the rep has a GHL API key configured.
      mirrorLeadToGHL(tenant.id, lead).catch(() => null)

      // If the linked sheet tracks fields we don't have yet, ask once.
      let missingPrompt = ''
      const sheetCfg = await getSheetCrmConfig(tenant.id).catch(() => null)
      if (sheetCfg) {
        const missing = await getMissingSheetFields(tenant.id, sheetCfg, {
          name: lead.name,
          email: lead.email ?? '',
          company: lead.company ?? '',
        }).catch(() => [] as string[])
        const labelMap: Record<string, string> = {
          email: 'email',
          company: 'company',
          phone: 'phone',
          name: 'full name',
        }
        const labels = missing.map((m) => labelMap[m] ?? m).filter(Boolean)
        if (labels.length > 0) {
          missingPrompt = `\n\n📋 To complete the row in your Google Sheet, send me their ${labels.join(', ')}. Just reply: \`${lead.name}'s ${labels[0]} is …\`.`
        }
      }

      return `➕ Added *${lead.name}*${lead.company ? ` (${lead.company})` : ''} as ${lead.status}.${sheetSuffix}${missingPrompt}`
    }

    case 'update_lead': {
      const target =
        knownLeads.find(
          (l) => l.name.toLowerCase() === intent.lead_name.toLowerCase(),
        ) ??
        knownLeads.find((l) =>
          l.name.toLowerCase().includes(intent.lead_name.toLowerCase()),
        )
      if (!target) {
        // No match — treat as a new lead with the note.
        const created = await upsertLead({
          repId: tenant.id,
          name: intent.lead_name,
          status: (intent.status as LeadStatus) ?? 'warm',
          notes: intent.note ?? null,
          touchContact: intent.mark_contacted ?? false,
          source: 'mira',
          ownerMemberId,
        })
        return `➕ Didn't find *${intent.lead_name}* — added them as ${created.status}.`
      }
      const updated = await upsertLead({
        repId: tenant.id,
        name: target.name,
        company: intent.company ?? undefined,
        email: intent.email ?? undefined,
        status: (intent.status as LeadStatus) ?? undefined,
        notes: intent.note ?? null,
        touchContact: intent.mark_contacted ?? false,
        ownerMemberId,
      })
      await mirrorLeadToSheet(tenant.id, {
        name: updated.name,
        email: updated.email,
        company: updated.company,
        phone: intent.phone ?? null,
        status: updated.status,
        notes: updated.notes,
        source: 'mira',
        last_contact: updated.last_contact,
      }).catch(() => null)
      mirrorLeadToGHL(tenant.id, updated, {
        note: intent.note ? `[Mira update] ${intent.note}` : undefined,
      }).catch(() => null)
      const bits: string[] = []
      if (intent.status) bits.push(`marked ${updated.status}`)
      if (intent.mark_contacted) bits.push('logged contact')
      if (intent.email) bits.push(`email saved`)
      if (intent.company) bits.push(`company saved`)
      if (intent.phone) bits.push(`phone saved`)
      if (intent.note) bits.push('added note')
      return `✏️ *${updated.name}* — ${bits.join(', ') || 'updated'}.`
    }

    case 'schedule_followup': {
      const target =
        knownLeads.find(
          (l) => l.name.toLowerCase() === intent.lead_name.toLowerCase(),
        ) ??
        knownLeads.find((l) =>
          l.name.toLowerCase().includes(intent.lead_name.toLowerCase()),
        )
      const leadLabel = target?.name ?? intent.lead_name
      brainItemQueue.push({
        item_type: 'task',
        content: `${intent.content} — ${leadLabel}`,
        priority: intent.priority ?? 'normal',
        horizon: 'day',
        due_date: intent.due_date,
        lead_id: target?.id ?? null,
      })

      // Best-effort: drop it onto their Google Calendar too.
      let calSuffix = ''
      try {
        // Default 9am local, 30 min, UTC (user's Google account handles display TZ).
        const startIso = `${intent.due_date}T14:00:00Z`
        const ev = await createCalendarEvent({
          repId: tenant.id,
          memberId: callerMember.id,
          summary: `${intent.content} — ${leadLabel}`,
          description: `Scheduled via ${brandLabel(tenant)}.`,
          startIso,
          timezone: 'UTC',
          attendees: target?.email ? [{ email: target.email, displayName: target.name }] : undefined,
        })
        if (ev) calSuffix = ' · 🗓 added to Google Calendar'
      } catch (err) {
        console.error('[mira] gcal create failed', err)
      }

      return `📅 Follow-up with *${leadLabel}* on ${intent.due_date}: ${intent.content}${calSuffix}`
    }

    case 'brain_item': {
      brainItemQueue.push({
        item_type: intent.item_type,
        content: intent.content,
        priority: intent.priority ?? 'normal',
        horizon: intent.horizon ?? 'none',
        due_date: intent.due_date ?? null,
      })
      const icon =
        intent.item_type === 'task'
          ? '✅'
          : intent.item_type === 'goal'
            ? '🎯'
            : intent.item_type === 'idea'
              ? '💡'
              : intent.item_type === 'plan'
                ? '🗺️'
                : '📝'
      return `${icon} ${intent.item_type}: ${intent.content}`
    }

    case 'log_call': {
      const target =
        knownLeads.find(
          (l) => l.name.toLowerCase() === intent.lead_name.toLowerCase(),
        ) ??
        knownLeads.find((l) =>
          l.name.toLowerCase().includes(intent.lead_name.toLowerCase()),
        )
      // Create the lead if missing so the call has somewhere to attach.
      const lead =
        target ??
        (await upsertLead({
          repId: tenant.id,
          name: intent.lead_name,
          status: intent.outcome === 'positive' || intent.outcome === 'booked' ? 'hot' : 'warm',
          source: 'mira',
          touchContact: true,
          ownerMemberId,
        }))

      const newCall = await logCall({
        repId: tenant.id,
        leadId: lead.id,
        contactName: lead.name,
        summary: intent.summary,
        outcome: intent.outcome ?? null,
        nextStep: intent.next_step ?? null,
        durationMinutes: intent.duration_minutes ?? null,
        ownerMemberId,
      })

      // Also update the lead — mark contacted, append a short note, optionally bump status.
      const noteLine = intent.summary.slice(0, 200)
      const updatedLead = await upsertLead({
        repId: tenant.id,
        name: lead.name,
        notes: noteLine,
        status:
          intent.outcome === 'closed_won'
            ? undefined
            : intent.outcome === 'positive' || intent.outcome === 'booked'
              ? 'hot'
              : intent.outcome === 'negative' || intent.outcome === 'closed_lost'
                ? 'dormant'
                : undefined,
        touchContact: true,
        ownerMemberId,
      })
      await mirrorLeadToSheet(tenant.id, {
        name: updatedLead.name,
        email: updatedLead.email,
        company: updatedLead.company,
        status: updatedLead.status,
        notes: updatedLead.notes,
        source: 'mira',
        last_contact: updatedLead.last_contact,
      }).catch(() => null)
      mirrorLeadToGHL(tenant.id, updatedLead, {
        note: `[Call logged] ${intent.outcome ? intent.outcome.replace(/_/g, ' ') + ' — ' : ''}${intent.summary.slice(0, 500)}${intent.next_step ? `\nNext step: ${intent.next_step}` : ''}`,
      }).catch(() => null)

      // Auto-extract deal value from the summary, e.g. "$12k", "50,000", "8k MRR".
      // Only if the lead doesn't already have a deal_value set (don't clobber).
      let dealValueAdded: number | null = null
      if (!updatedLead.deal_value) {
        const m = intent.summary.match(/\$?\s?([\d]{1,3}(?:[,\d]{0,7})(?:\.\d{1,2})?)\s?(k|m|mm)?\b/i)
        if (m) {
          const raw = parseFloat(m[1].replace(/,/g, ''))
          const mult = m[2]?.toLowerCase() === 'k' ? 1000 : m[2]?.toLowerCase() === 'm' || m[2]?.toLowerCase() === 'mm' ? 1_000_000 : 1
          const value = Math.round(raw * mult)
          // Only accept if it looks like a deal-value number (>= $500, <= $100M).
          if (value >= 500 && value <= 100_000_000) {
            const { error: dvErr } = await supabase
              .from('leads')
              .update({ deal_value: value, deal_currency: 'USD' })
              .eq('id', lead.id)
              .eq('rep_id', tenant.id)
            if (!dvErr) dealValueAdded = value
          }
        }
      }

      const tail = intent.next_step ? ` · next: ${intent.next_step}` : ''
      const dvTail = dealValueAdded ? ` · 💰 $${dealValueAdded.toLocaleString()}` : ''

      return `📞 Logged call with *${lead.name}*${intent.outcome ? ` (${intent.outcome.replace('_', ' ')})` : ''}${tail}${dvTail}`
    }

    case 'book_meeting': {
      const target = intent.lead_name
        ? knownLeads.find(
            (l) => l.name.toLowerCase() === intent.lead_name!.toLowerCase(),
          ) ??
          knownLeads.find((l) =>
            l.name.toLowerCase().includes(intent.lead_name!.toLowerCase()),
          )
        : null
      const contactName = target?.name ?? intent.contact_name ?? intent.lead_name ?? 'Meeting'
      const attendeeEmail = intent.email ?? target?.email ?? null
      const duration = intent.duration_minutes ?? 30
      const startIso = intent.start_iso
      const endIso = new Date(new Date(startIso).getTime() + duration * 60_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')

      const conflict = await findConflict(tenant.id, startIso, endIso, { memberId: callerMember.id })
      const tz = callerMember.timezone || tenant.timezone || 'UTC'
      const whenStr = new Date(startIso).toLocaleString('en-US', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })

      // Use agent-provided summary when it's clean; otherwise fall back to
      // "Meeting with <name>". Never dump the raw user message as the title.
      const title =
        intent.summary && intent.summary.length <= 80
          ? intent.summary
          : `Meeting with ${contactName}`
      const description = intent.notes ?? `Booked via ${brandLabel(tenant)}.`

      let ev: Awaited<ReturnType<typeof createCalendarEvent>> | null = null
      try {
        ev = await createCalendarEvent({
          repId: tenant.id,
          memberId: callerMember.id,
          summary: title,
          description,
          startIso,
          endIso,
          timezone: tz,
          attendees: attendeeEmail
            ? [{ email: attendeeEmail, displayName: contactName }]
            : undefined,
        })
      } catch (err) {
        console.error('[mira] createCalendarEvent failed', err)
      }

      // Mirror as a task so it shows on the rep's dashboard.
      try {
        const dump = await createBrainDump({
          repId: tenant.id,
          rawText: `Booked: ${title}`,
          summary: '',
          source: 'mic',
          ownerMemberId: callerMember.id,
        })
        await createBrainItems(
          tenant.id,
          dump.id,
          [
            {
              item_type: 'task',
              content: `${title} — ${new Date(startIso).toLocaleString('en-US', { timeZone: tz })}`,
              priority: 'high',
              horizon: 'day',
              due_date: startIso.slice(0, 10),
            },
          ],
          callerMember.id,
        )
      } catch (err) {
        console.error('[mira] booking brain-item mirror failed', err)
      }

      const conflictWarning = conflict
        ? `\n⚠️ You already have something from ${new Date(conflict.startIso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })} to ${new Date(conflict.endIso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })} — both are on the calendar now. Say "cancel last" if you need to remove one.`
        : ''

      if (!ev) {
        return `📅 Couldn't reach Google Calendar — saved *${title}* as a task for ${whenStr}. Connect Google on your dashboard to auto-book next time.${conflictWarning}`
      }
      return `📅 Booked *${title}* for ${whenStr}${attendeeEmail ? ` · invite sent to ${attendeeEmail}` : ''} — added to your calendar.${conflictWarning}`
    }

    case 'reschedule_meeting':
    case 'cancel_meeting': {
      const tz = callerMember.timezone || tenant.timezone || 'UTC'
      const target = intent.lead_name
        ? knownLeads.find(
            (l) => l.name.toLowerCase() === intent.lead_name!.toLowerCase(),
          ) ??
          knownLeads.find((l) =>
            l.name.toLowerCase().includes(intent.lead_name!.toLowerCase()),
          )
        : null
      const who =
        target?.name ||
        intent.lead_name ||
        intent.contact_name ||
        ''
      if (!who) {
        return intent.kind === 'reschedule_meeting'
          ? "Who is the meeting with? Try: \"reschedule my call with Dana to Thursday 10am\"."
          : "Who is the meeting with? Try: \"cancel my call with Dana\"."
      }

      // Search the calendar. If we have a date hint, narrow the window.
      let fromIso: string | undefined
      let toIso: string | undefined
      if (intent.original_when) {
        const day = intent.original_when.slice(0, 10)
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          fromIso = `${day}T00:00:00Z`
          // 2-day window to absorb timezone offsets.
          toIso = new Date(new Date(fromIso).getTime() + 2 * 86400_000).toISOString()
        }
      }
      const events = await findCalendarEventsByQuery(
        tenant.id,
        target?.email || who,
        { fromIso, toIso, maxResults: 5, memberId: callerMember.id },
      )
      if (events === null) {
        return "Google Calendar isn't connected yet — link it on your dashboard so I can move events for you."
      }
      if (events.length === 0) {
        return `Couldn't find a calendar event matching *${who}*${intent.original_when ? ` around ${intent.original_when}` : ''}. Want me to book a new one instead?`
      }

      // Pick the soonest as the primary candidate; keep the rest as alts.
      const sorted = [...events].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      )
      const primary = sorted[0]
      const alts = sorted.slice(1)

      const settings = (callerMember.settings ?? {}) as Record<string, unknown>

      if (intent.kind === 'reschedule_meeting') {
        const newStart = intent.new_start_iso
        const duration =
          intent.new_duration_minutes ??
          Math.max(
            15,
            Math.round(
              (new Date(primary.end).getTime() - new Date(primary.start).getTime()) / 60_000,
            ) || 30,
          )
        await updateMember(callerMember.id, {
          settings: {
            ...settings,
            pending_action: 'reschedule_confirm',
            pending_calendar_event_id: primary.id,
            pending_calendar_new_start_iso: newStart,
            pending_calendar_new_duration_minutes: duration,
            pending_calendar_summary: primary.summary,
            pending_calendar_alts: alts.map((e) => ({
              id: e.id,
              start: e.start,
              end: e.end,
              summary: e.summary,
            })),
          },
        })
        const altsText =
          alts.length > 0
            ? `\n\nOr did you mean one of these? Reply with the number:\n${alts
                .map(
                  (e, i) =>
                    `${i + 2}. *${e.summary}* — ${formatLocalDateTime(e.start, tz)}`,
                )
                .join('\n')}`
            : ''
        return `🔁 The one with *${primary.summary}* on *${formatLocalDateTime(primary.start, tz)}* — move it to *${formatLocalDateTime(newStart, tz)}*, right?\n\nReply *yes* to confirm, *no* to cancel.${altsText}`
      } else {
        // cancel_meeting
        await updateMember(callerMember.id, {
          settings: {
            ...settings,
            pending_action: 'cancel_confirm',
            pending_calendar_event_id: primary.id,
            pending_calendar_summary: primary.summary,
            pending_calendar_alts: alts.map((e) => ({
              id: e.id,
              start: e.start,
              end: e.end,
              summary: e.summary,
            })),
          },
        })
        const altsText =
          alts.length > 0
            ? `\n\nOr did you mean one of these? Reply with the number:\n${alts
                .map(
                  (e, i) =>
                    `${i + 2}. *${e.summary}* — ${formatLocalDateTime(e.start, tz)}`,
                )
                .join('\n')}`
            : ''
        return `🗑 The one with *${primary.summary}* on *${formatLocalDateTime(primary.start, tz)}* — cancel it, right?\n\nReply *yes* to confirm, *no* to keep it.${altsText}`
      }
    }

    case 'pipeline_triage': {
      const count = Math.min(Math.max(intent.count ?? 5, 1), 15)
      const allLeads = await getAllLeads(tenant.id)
      // Member-scoped if a rep, otherwise see everything.
      const ownLeads = isAtLeast(callerMember.role, 'manager')
        ? allLeads
        : allLeads.filter((l) => !l.owner_member_id || l.owner_member_id === callerMember.id)
      const now = Date.now()
      const active = ownLeads.filter((l) => {
        if (l.status === 'dormant') return false
        if (l.snoozed_until && new Date(l.snoozed_until).getTime() > now) return false
        return true
      })
      // Score: hot=100, warm=60, cold=20; +deal_value/1000 capped at 50;
      // +days-since-last-contact (encourages overdue touches).
      const statusScore: Record<string, number> = { hot: 100, warm: 60, cold: 20 }
      const scored = active.map((l) => {
        const days = l.last_contact
          ? Math.floor((now - new Date(l.last_contact).getTime()) / 86_400_000)
          : 30
        const valueBoost = Math.min(50, (l.deal_value ?? 0) / 1000)
        const score = (statusScore[l.status] ?? 0) + Math.min(days, 30) + valueBoost
        return { lead: l, score, days }
      })
      scored.sort((a, b) => b.score - a.score)
      const top = scored.slice(0, count)
      if (top.length === 0) {
        return "Pipeline's empty (or all snoozed). Add a few prospects and I'll prioritize them for you."
      }
      return generateReport(
        'triage',
        {
          asked_for: count,
          leads: top.map((s) => ({
            name: s.lead.name,
            company: s.lead.company,
            status: s.lead.status,
            deal_value: s.lead.deal_value,
            days_since_contact: s.days,
            notes: (s.lead.notes ?? '').slice(0, 120),
          })),
        },
        tenant.display_name,
      )
    }

    case 'snooze_lead': {
      const lead = findLeadInList(knownLeads, intent.lead_name)
      if (!lead) return `Couldn't find *${intent.lead_name}* in your prospects.`
      let untilIso: string | null = null
      if (intent.until_date && /^\d{4}-\d{2}-\d{2}$/.test(intent.until_date)) {
        untilIso = `${intent.until_date}T09:00:00Z`
      } else if (intent.within) {
        const map: Record<string, number> = { '1d': 1, '3d': 3, '1w': 7, '2w': 14, '1m': 30 }
        const days = map[intent.within] ?? 7
        untilIso = new Date(Date.now() + days * 86_400_000).toISOString()
      } else {
        untilIso = new Date(Date.now() + 7 * 86_400_000).toISOString()
      }
      const { error } = await supabase
        .from('leads')
        .update({ snoozed_until: untilIso })
        .eq('id', lead.id)
        .eq('rep_id', tenant.id)
      if (error) {
        console.error('[mira] snooze_lead failed', error)
        return `Couldn't snooze *${lead.name}* — try again.`
      }
      const when = new Date(untilIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return `🔕 Snoozed *${lead.name}* until ${when}. They'll pop back into triage then.`
    }

    case 'set_deal_value': {
      const lead = findLeadInList(knownLeads, intent.lead_name)
      if (!lead) return `Couldn't find *${intent.lead_name}* in your prospects.`
      const value = Math.round(intent.deal_value)
      if (!Number.isFinite(value) || value < 0) {
        return `That deal value didn't parse — try \"Acme is a $12k deal\".`
      }
      const { error } = await supabase
        .from('leads')
        .update({ deal_value: value, deal_currency: intent.currency || 'USD' })
        .eq('id', lead.id)
        .eq('rep_id', tenant.id)
      if (error) {
        console.error('[mira] set_deal_value failed', error)
        return `Couldn't update *${lead.name}* — try again.`
      }
      return `💰 *${lead.name}* — deal value set to $${value.toLocaleString()}.`
    }

    case 'handoff_lead': {
      if (!isAtLeast(callerMember.role, 'manager')) {
        return "Lead reassignment is for managers and admins."
      }
      const lead = findLeadInList(knownLeads, intent.lead_name)
      if (!lead) return `Couldn't find *${intent.lead_name}* in your prospects.`
      const allMembers = await listMembers(tenant.id)
      const newOwner = matchMemberByName(allMembers, intent.to_member_name, callerMember.id)
      if (!newOwner) {
        return `Couldn't find *${intent.to_member_name}* on your team.`
      }
      const { error } = await supabase
        .from('leads')
        .update({ owner_member_id: newOwner.id })
        .eq('id', lead.id)
        .eq('rep_id', tenant.id)
      if (error) {
        console.error('[mira] handoff_lead failed', error)
        return `Couldn't reassign *${lead.name}* — try again.`
      }
      return `🤝 Reassigned *${lead.name}* to *${newOwner.display_name}*.`
    }

    case 'objection_coach': {
      // Don't let the AI answer — log it for the rep's manager(s). It shows up
      // in their coaching queue on the Feedback page. Real humans coach.
      const managers = await listPitchableManagers(tenant.id, callerMember.id)
      if (managers.length === 0) {
        return 'No manager is set up to coach yet. Add a manager on the Org page and I can log this for them.'
      }
      let logged = 0
      const reached: typeof managers = []
      for (const mgr of managers) {
        try {
          await createMemo({
            repId: tenant.id,
            senderMemberId: callerMember.id,
            recipientMemberId: mgr.id,
            kind: 'coaching',
            transcript: intent.objection,
          })
          logged++
          reached.push(mgr)
        } catch (err) {
          console.error('[mira] objection_coach memo failed', err)
        }
      }
      if (logged === 0) {
        return "Couldn't log that for your manager. Try again in a sec."
      }
      const names = reached
        .slice(0, 3)
        .map((m) => m.display_name.split(/\s+/)[0])
        .join(', ')
      return `🎯 Logged your question for ${names}${reached.length > 3 ? ` +${reached.length - 3}` : ''}. It's in their coaching queue on the Feedback page.`
    }

    case 'rep_pulse': {
      if (!isAtLeast(callerMember.role, 'manager')) {
        return "Rep pulses are for managers and admins. Want your own pulse instead? Try \"how am I doing this week\"."
      }
      const allMembers = await listMembers(tenant.id)
      const subject = matchMemberByName(allMembers, intent.member_name, null)
      if (!subject) return `Couldn't find *${intent.member_name}* on your team.`
      // Permission: admin+ sees anyone; managers only their managed teams.
      if (!isAtLeast(callerMember.role, 'admin')) {
        const managed = await getManagedTeamIds(callerMember.id)
        if (managed.length > 0) {
          const { data: subjTeams } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('member_id', subject.id)
          const overlap = (subjTeams ?? []).some((r) =>
            managed.includes((r as { team_id: string }).team_id),
          )
          if (!overlap) return `*${subject.display_name}* isn't on a team you manage.`
        }
      }
      const period = intent.period ?? 'week'
      const since = new Date(
        Date.now() - (period === 'day' ? 1 : period === 'month' ? 30 : 7) * 86_400_000,
      ).toISOString()
      const { data: callsRaw } = await supabase
        .from('call_logs')
        .select('outcome, occurred_at, summary, contact_name')
        .eq('rep_id', tenant.id)
        .eq('owner_member_id', subject.id)
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
      const calls = (callsRaw ?? []) as Array<{
        outcome: string | null
        occurred_at: string
        summary: string
        contact_name: string
      }>
      const { data: leadsRaw } = await supabase
        .from('leads')
        .select('status, deal_value, last_contact')
        .eq('rep_id', tenant.id)
        .eq('owner_member_id', subject.id)
      const leads = (leadsRaw ?? []) as Array<{
        status: string
        deal_value: number | null
        last_contact: string | null
      }>
      return generateReport(
        'rep_pulse',
        {
          rep: subject.display_name,
          period,
          calls: {
            total: calls.length,
            booked: calls.filter((c) => c.outcome === 'booked').length,
            won: calls.filter((c) => c.outcome === 'closed_won').length,
            lost: calls.filter((c) => c.outcome === 'closed_lost').length,
          },
          recent_summaries: calls.slice(0, 5).map((c) => `${c.contact_name}: ${c.summary}`),
          pipeline: {
            hot: leads.filter((l) => l.status === 'hot').length,
            warm: leads.filter((l) => l.status === 'warm').length,
            cold: leads.filter((l) => l.status === 'cold').length,
            total_value: leads.reduce((sum, l) => sum + (l.deal_value ?? 0), 0),
          },
        },
        tenant.display_name,
      )
    }

    case 'leaderboard': {
      if (!isAtLeast(callerMember.role, 'admin')) {
        return "Leaderboards are admin/owner only."
      }
      const period = intent.period ?? 'week'
      const since = new Date(
        Date.now() -
          (period === 'day' ? 1 : period === 'month' ? 30 : period === 'quarter' ? 90 : 7) *
            86_400_000,
      ).toISOString()
      const allMembers = await listMembers(tenant.id)
      const eligible = allMembers.filter((m) => m.role !== 'observer' && m.is_active !== false)
      const { data: callsRaw } = await supabase
        .from('call_logs')
        .select('owner_member_id, outcome')
        .eq('rep_id', tenant.id)
        .gte('occurred_at', since)
      const calls = (callsRaw ?? []) as Array<{ owner_member_id: string | null; outcome: string | null }>
      const board = eligible
        .map((m) => {
          const own = calls.filter((c) => c.owner_member_id === m.id)
          return {
            name: m.display_name,
            calls: own.length,
            booked: own.filter((c) => c.outcome === 'booked').length,
            won: own.filter((c) => c.outcome === 'closed_won').length,
          }
        })
        .filter((r) => r.calls > 0)
        .sort((a, b) => {
          const metric = intent.metric ?? 'deals_closed'
          if (metric === 'calls') return b.calls - a.calls
          if (metric === 'meetings_booked') return b.booked - a.booked
          return b.won - a.won || b.booked - a.booked || b.calls - a.calls
        })
        .slice(0, 10)
      if (board.length === 0) {
        return `📊 No activity logged in the last ${period}. Once reps log calls it'll show up here.`
      }
      return generateReport('leaderboard', { period, metric: intent.metric ?? 'deals_closed', board }, tenant.display_name)
    }

    case 'forecast': {
      if (!isAtLeast(callerMember.role, 'admin')) {
        return "Forecasts are admin/owner only."
      }
      const period = intent.period ?? 'month'
      const allLeads = await getAllLeads(tenant.id)
      // Weight by status: hot=0.6, warm=0.3, cold=0.1, dormant=0.
      const weights: Record<string, number> = { hot: 0.6, warm: 0.3, cold: 0.1, dormant: 0 }
      const open = allLeads.filter((l) => (l.deal_value ?? 0) > 0)
      const weighted = open.reduce((s, l) => s + (l.deal_value ?? 0) * (weights[l.status] ?? 0), 0)
      const bestCase = open.reduce(
        (s, l) => s + (l.status === 'dormant' ? 0 : (l.deal_value ?? 0)),
        0,
      )
      const commit = open
        .filter((l) => l.status === 'hot')
        .reduce((s, l) => s + (l.deal_value ?? 0), 0)
      return generateReport(
        'forecast',
        {
          period,
          open_deals: open.length,
          commit_usd: Math.round(commit),
          weighted_usd: Math.round(weighted),
          best_case_usd: Math.round(bestCase),
          top_deals: open
            .filter((l) => l.status === 'hot' || l.status === 'warm')
            .sort((a, b) => (b.deal_value ?? 0) - (a.deal_value ?? 0))
            .slice(0, 5)
            .map((l) => ({ name: l.name, status: l.status, value: l.deal_value })),
        },
        tenant.display_name,
      )
    }

    case 'winloss': {
      const period = intent.period ?? 'month'
      const days = period === 'week' ? 7 : period === 'quarter' ? 90 : 30
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      const { data: callsRaw } = await supabase
        .from('call_logs')
        .select('outcome, summary, contact_name')
        .eq('rep_id', tenant.id)
        .gte('occurred_at', since)
        .in('outcome', ['closed_won', 'closed_lost'])
        .order('occurred_at', { ascending: false })
        .limit(60)
      const calls = (callsRaw ?? []) as Array<{
        outcome: string | null
        summary: string
        contact_name: string
      }>
      const won = calls.filter((c) => c.outcome === 'closed_won')
      const lost = calls.filter((c) => c.outcome === 'closed_lost')
      if (calls.length === 0) {
        return `📊 No closed deals logged in the last ${days} days yet.`
      }
      return generateReport(
        'winloss',
        {
          period,
          counts: { won: won.length, lost: lost.length },
          win_rate_pct: Math.round((100 * won.length) / Math.max(1, calls.length)),
          won_summaries: won.slice(0, 8).map((c) => `${c.contact_name}: ${c.summary}`),
          lost_summaries: lost.slice(0, 8).map((c) => `${c.contact_name}: ${c.summary}`),
        },
        tenant.display_name,
      )
    }

    case 'inbox_zero': {
      const days = Math.min(Math.max(intent.days ?? 3, 1), 30)
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
      const allLeads = await getAllLeads(tenant.id)
      const own = isAtLeast(callerMember.role, 'manager')
        ? allLeads
        : allLeads.filter((l) => !l.owner_member_id || l.owner_member_id === callerMember.id)
      const now = Date.now()
      const overdue = own.filter((l) => {
        if (l.status !== 'hot' && l.status !== 'warm') return false
        if (l.snoozed_until && new Date(l.snoozed_until).getTime() > now) return false
        if (!l.last_contact) return true
        return l.last_contact < cutoff
      })
      // Pull scheduled follow-ups so we can exclude leads that already have one queued.
      const leadIds = overdue.map((l) => l.id)
      const scheduled = new Set<string>()
      if (leadIds.length > 0) {
        const { data: tasks } = await supabase
          .from('brain_items')
          .select('content')
          .eq('rep_id', tenant.id)
          .eq('item_type', 'task')
          .eq('status', 'open')
          .gte('due_date', new Date().toISOString().slice(0, 10))
        for (const t of (tasks ?? []) as Array<{ content: string }>) {
          for (const l of overdue) {
            if (t.content.toLowerCase().includes(l.name.toLowerCase())) scheduled.add(l.id)
          }
        }
      }
      const stuck = overdue
        .filter((l) => !scheduled.has(l.id))
        .map((l) => ({
          name: l.name,
          company: l.company,
          status: l.status,
          days_since: l.last_contact
            ? Math.floor((now - new Date(l.last_contact).getTime()) / 86_400_000)
            : null,
          deal_value: l.deal_value,
        }))
        .sort((a, b) => (b.days_since ?? 999) - (a.days_since ?? 999))
        .slice(0, 12)
      if (stuck.length === 0) {
        return `📥 Inbox zero — no hot/warm leads waiting on you (within ${days} days).`
      }
      return generateReport('inbox_zero', { days, stuck }, tenant.display_name)
    }

    case 'commission_report': {
      const period = intent.period ?? 'month'
      const now = new Date()
      const start = new Date(now)
      if (period === 'day') start.setUTCHours(0, 0, 0, 0)
      else if (period === 'week') {
        const dow = (start.getUTCDay() + 6) % 7
        start.setUTCDate(start.getUTCDate() - dow)
        start.setUTCHours(0, 0, 0, 0)
      } else if (period === 'month') start.setUTCDate(1), start.setUTCHours(0, 0, 0, 0)
      else if (period === 'quarter') {
        const q = Math.floor(start.getUTCMonth() / 3) * 3
        start.setUTCMonth(q, 1), start.setUTCHours(0, 0, 0, 0)
      } else if (period === 'year') start.setUTCMonth(0, 1), start.setUTCHours(0, 0, 0, 0)
      const sinceIso = start.toISOString()

      // Reps see their own; managers/admins see the team total.
      let query = supabase
        .from('call_logs')
        .select('commission_amount, occurred_at, contact_name')
        .eq('rep_id', tenant.id)
        .not('commission_amount', 'is', null)
        .gte('occurred_at', sinceIso)
      if (!isAtLeast(callerMember.role, 'manager')) {
        query = query.eq('owner_member_id', callerMember.id)
      }
      const { data: rows } = await query
      const list = (rows ?? []) as Array<{ commission_amount: number; occurred_at: string; contact_name: string }>
      const total = list.reduce((sum, r) => sum + Number(r.commission_amount ?? 0), 0)
      const count = list.length
      if (count === 0) {
        return `💰 No commission logged yet for *${period}*. Log a closed_won call and I'll ask you the commission amount.`
      }
      const top = [...list].sort((a, b) => b.commission_amount - a.commission_amount).slice(0, 5)
      const lines = [
        `💰 *Commission · ${period}* — $${Math.round(total).toLocaleString()} across ${count} deal${count === 1 ? '' : 's'}`,
        '',
        ...top.map((r) => `• ${r.contact_name}: $${Math.round(r.commission_amount).toLocaleString()}`),
      ]
      return lines.join('\n')
    }

    case 'set_target': {
      const requestedScope = intent.scope ?? 'personal'
      const isManager = isAtLeast(callerMember.role, 'manager')
      const isAdmin = isAtLeast(callerMember.role, 'admin')

      // Resolve scope + team_id with permission gates. Reps and observers
      // always fall through to personal regardless of what they asked for.
      let scope: 'personal' | 'team' | 'account' = 'personal'
      let teamId: string | null = null
      let teamName: string | null = null

      if (requestedScope === 'account' && isAdmin) {
        scope = 'account'
      } else if (requestedScope === 'team' && isManager) {
        // Find the team by name if given, else default to the caller's first
        // managed team (admins fall back to any team in the account).
        let resolvedTeamId: string | null = null
        if (intent.team_name) {
          const { data: row } = await supabase
            .from('teams')
            .select('id, name')
            .eq('rep_id', tenant.id)
            .ilike('name', intent.team_name)
            .maybeSingle()
          if (row) {
            resolvedTeamId = (row as { id: string }).id
            teamName = (row as { name: string }).name
          }
        }
        if (!resolvedTeamId) {
          const managed = await getManagedTeamIds(callerMember.id)
          if (managed.length > 0) resolvedTeamId = managed[0]
          else if (isAdmin) {
            const { data: anyTeam } = await supabase
              .from('teams')
              .select('id, name')
              .eq('rep_id', tenant.id)
              .limit(1)
              .maybeSingle()
            if (anyTeam) {
              resolvedTeamId = (anyTeam as { id: string }).id
              teamName = (anyTeam as { name: string }).name
            }
          }
        }
        if (resolvedTeamId) {
          // Permission check for non-admin managers.
          if (!isAdmin) {
            const managed = await getManagedTeamIds(callerMember.id)
            if (!managed.includes(resolvedTeamId)) {
              return `🎯 You don't manage that team — saving as a personal goal instead.`
            }
          }
          scope = 'team'
          teamId = resolvedTeamId
          if (!teamName && resolvedTeamId) {
            const { data: trow } = await supabase
              .from('teams')
              .select('name')
              .eq('id', resolvedTeamId)
              .maybeSingle()
            teamName = (trow as { name: string } | null)?.name ?? null
          }
        }
      }

      // Visibility (who actually sees this goal). Reps can only set 'all'.
      // Managers can set 'all' or 'managers'. Admins/owners can set anything.
      let visibility: 'all' | 'managers' | 'owners' = 'all'
      if (intent.visibility === 'owners' && isAdmin) visibility = 'owners'
      else if (intent.visibility === 'managers' && isManager) visibility = 'managers'
      else if (intent.visibility === 'all' || !intent.visibility) visibility = 'all'

      const t = await setTarget({
        repId: tenant.id,
        periodType: intent.period_type,
        metric: intent.metric,
        targetValue: intent.target_value,
        notes: intent.notes ?? null,
        ownerMemberId,
        teamId,
        scope,
        visibility,
      })

      if (scope !== 'personal') {
        const scopeLabel = scope === 'account' ? 'the account' : teamName ? `the ${teamName} team` : 'the team'
        const visTag = visibility === 'owners' ? ' · _owners only_' : visibility === 'managers' ? ' · _managers only_' : ''
        return `🎯 ${scope === 'account' ? 'Account' : 'Team'} goal locked in: *${t.target_value} ${t.metric.replace('_', ' ')}* this ${t.period_type} for ${scopeLabel}${visTag}.`
      }
      const visTag = visibility === 'owners' ? ' · _owners only_' : visibility === 'managers' ? ' · _managers only_' : ''
      return `🎯 Target locked in: *${t.target_value} ${t.metric.replace('_', ' ')}* this ${t.period_type}${visTag}.`
    }

    case 'report': {
      const reply = await runReport(intent.report_type, intent.lead_name ?? null, tenant, callerMember.id)
      return reply
    }

    case 'defer_item': {
      // Park into the caller's deferred-items inbox. Source tracking comes
      // from context where possible — for now we record it as a self-deferral
      // (the inbox UI shows lead/memo links via the optional pointers below
      // when the model identifies them; reply-threaded handlers fill in
      // source_member_id / source_memo_id automatically elsewhere).
      let sourceLeadId: string | null = null
      if (intent.source_lead_name) {
        const lead =
          knownLeads.find(
            (l) => l.name.toLowerCase() === intent.source_lead_name!.toLowerCase(),
          ) ??
          knownLeads.find((l) =>
            l.name.toLowerCase().includes(intent.source_lead_name!.toLowerCase()),
          )
        sourceLeadId = lead?.id ?? null
      }
      const source: DeferredSource = sourceLeadId ? 'lead' : 'self'
      try {
        await createDeferredItem({
          repId: tenant.id,
          ownerMemberId: callerMember.id,
          source,
          sourceLeadId,
          title: intent.title,
          body: intent.body ?? null,
          remindAt: intent.remind_at_iso ?? null,
        })
      } catch (err) {
        console.error('[mira] defer_item failed', err)
        return `Couldn't park that one — try again in a sec.`
      }
      const when = intent.remind_at_iso
        ? ` for ${intent.remind_at_iso.slice(0, 16).replace('T', ' ')}`
        : ''
      return `🗂️ Parked in your inbox${when}: *${intent.title}*`
    }

    case 'complete_task': {
      // Handled in batch by the main webhook handler before executeIntent
      // is reached. This case is unreachable in practice, but kept so the
      // TypeScript switch stays exhaustive.
      return null
    }

    case 'move_task': {
      // Fuzzy-match an open brain_item the caller owns, then stash a pending
      // confirm_move so the next reply is interpreted as YES / NO / numeric pick.
      const raw = (intent.query ?? '').trim()
      if (!raw) return "What task did you want to move? Tell me which one."
      const words = raw
        .toLowerCase()
        .split(/\s+/)
        .filter(
          (w) =>
            w.length > 2 &&
            !['the', 'and', 'for', 'with', 'task', 'item', 'about', 'that', 'this'].includes(w),
        )
      const orClauses =
        words.length > 0
          ? words.map((w) => `content.ilike.%${w}%`).join(',')
          : `content.ilike.%${raw}%`
      const { data: matches } = await supabase
        .from('brain_items')
        .select('id, content, due_date, priority')
        .eq('rep_id', tenant.id)
        .eq('owner_member_id', callerMember.id)
        .eq('status', 'open')
        .or(orClauses)
        .order('created_at', { ascending: false })
        .limit(5)
      const rows = (matches ?? []) as Array<{ id: string; content: string; due_date: string | null; priority: string | null }>
      if (rows.length === 0) {
        return `🤷 Didn't find an open task matching *"${raw}"* — check your dashboard.`
      }
      const newDue = intent.new_due_date ?? null
      const newContent = intent.new_content ?? null
      const newPriority = intent.new_priority ?? null
      if (!newDue && !newContent && !newPriority) {
        return `What should change on *${rows[0].content}*? Tell me a new date, new wording, or new priority.`
      }
      const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
      await updateMember(callerMember.id, {
        settings: {
          ...settingsNow,
          pending_action: 'confirm_move',
          pending_action_set_at: new Date().toISOString(),
          pending_move_ids: rows.map((r) => r.id),
          pending_move_labels: rows.map((r) => r.content),
          pending_move_new_due: newDue,
          pending_move_new_content: newContent,
          pending_move_new_priority: newPriority,
        },
      })
      const changes: string[] = []
      if (newDue) changes.push(`due → ${newDue}`)
      if (newContent) changes.push(`rename → "${newContent}"`)
      if (newPriority) changes.push(`priority → ${newPriority}`)
      if (rows.length === 1) {
        return `🔀 Update *${rows[0].content}*?\n${changes.map((c) => '• ' + c).join('\n')}\n\nReply *YES* to confirm, *NO* to cancel.`
      }
      const list = rows.map((r, i) => `${i + 1}. ${r.content}`).join('\n')
      return `🔀 Which one did you mean?\n\n${list}\n\nChange would be: ${changes.join(', ')}.\nReply with a number (e.g. \`1\`), or *NO* to cancel.`
    }

    case 'log_kpi': {
      const today = new Date().toISOString().slice(0, 10)
      const day = intent.date ?? today
      const mode: 'set' | 'increment' = intent.mode === 'increment' ? 'increment' : 'set'
      const cleaned = (intent.metrics ?? [])
        .map((m) => {
          if (!m || typeof m.value !== 'number' || !Number.isFinite(m.value)) return null
          if (m.value < 0 || m.value > 100_000_000) return null
          const norm = normalizeMetric({ key: m.key ?? null, label: m.label || m.key || 'metric' })
          // Auto-tag currency metrics so the dashboard formats them as money
          // even when the rep didn't say "USD".
          const unit =
            m.unit ?? (isCurrencyMetric(norm.key) ? 'USD' : null)
          return { ...norm, value: m.value, unit }
        })
        .filter((v): v is { key: string; label: string; value: number; unit: string | null } => !!v)
      if (!cleaned.length) {
        return "I caught you talking numbers but couldn't pin them to a metric. Try \"100 dials, 25 convos, 5 sets today\"."
      }

      const existing: Array<{ card: KpiCard; value: number; label: string }> = []
      const missing: Array<{ key: string; label: string; value: number; unit: string | null }> = []
      for (const m of cleaned) {
        // Match across any period — if the rep already chose week/month for
        // this metric, don't pester them again. We only stage as "missing"
        // when the metric has no card at all yet.
        const card = await findAnyCardForMetric(tenant.id, callerMember.id, m.key)
        if (card) existing.push({ card, value: m.value, label: card.label })
        else missing.push(m)
      }

      // Log every metric that already has a card.
      for (const e of existing) {
        try {
          await logKpiEntry({
            repId: tenant.id,
            memberId: callerMember.id,
            cardId: e.card.id,
            day,
            value: e.value,
            mode,
          })
        } catch (err) {
          console.error('[log_kpi] entry log failed', err)
        }
      }

      const dayLabel = day === today ? 'today' : day
      const fmt = (v: number, unit: string | null) =>
        unit === 'USD' ? `$${v.toLocaleString()}` : `${v}`
      if (!missing.length) {
        const summary = existing
          .map((e) => `*${fmt(e.value, e.card.unit)}* ${e.label}`)
          .join(' · ')
        return `📊 Logged ${summary} for ${dayLabel}. /dashboard for the full view.`
      }

      // Stage the missing metrics for the period-picker buttons. We do NOT
      // create the cards yet — the rep gets to opt in via inline keyboard.
      const settingsNow = (callerMember.settings ?? {}) as Record<string, unknown>
      await updateMember(callerMember.id, {
        settings: {
          ...settingsNow,
          pending_action: 'await_kpi_cards_confirm',
          pending_action_set_at: new Date().toISOString(),
          pending_kpi_metrics: missing,
          pending_kpi_date: day,
        },
      })

      const existingLine = existing.length
        ? `Updated *${existing.map((e) => e.label).join(', ')}* on your dashboard. `
        : ''
      const missingList = missing
        .map((m) => `• *${fmt(m.value, m.unit)}* ${m.label}`)
        .join('\n')
      const promptText = `📊 ${existingLine}New ones I haven't seen before:\n${missingList}\n\nHow should I track ${missing.length === 1 ? 'this' : 'these'}?`
      return `${promptText}\n\nReply *daily*, *weekly*, *monthly*, or *once*.`
    }

    case 'create_kpi_card': {
      const norm = normalizeMetric({
        key: intent.metric_key ?? null,
        label: intent.label || intent.metric_key || 'metric',
      })
      const period: 'day' | 'week' | 'month' = intent.period ?? 'day'
      const existingCard = await findKpiCard(tenant.id, callerMember.id, norm.key, period)
      if (existingCard) {
        // If the rep is updating the goal ("set my dial goal to 150"),
        // patch the existing card instead of bouncing them back. Otherwise
        // just confirm it's already tracked.
        if (
          intent.goal_value !== null &&
          intent.goal_value !== undefined &&
          Number.isFinite(intent.goal_value) &&
          intent.goal_value !== existingCard.goal_value
        ) {
          await supabase
            .from('kpi_cards')
            .update({ goal_value: intent.goal_value, updated_at: new Date().toISOString() })
            .eq('id', existingCard.id)
            .eq('rep_id', tenant.id)
          return `🎯 Updated *${existingCard.label}* goal to *${intent.goal_value}* per ${period}. Send your number anytime to log progress.`
        }
        return `Already tracking *${existingCard.label}* on your dashboard${existingCard.goal_value ? ` (goal: ${existingCard.goal_value})` : ''}. Just send the number anytime to update it.`
      }
      try {
        const card = await createKpiCard({
          repId: tenant.id,
          memberId: callerMember.id,
          metricKey: norm.key,
          label: norm.label,
          unit: intent.unit ?? null,
          period,
          goalValue: intent.goal_value ?? null,
        })
        const goalLine = card.goal_value ? ` Daily goal: *${card.goal_value}*.` : ''
        return `📌 Added *${card.label}* to your dashboard.${goalLine} Send your number whenever ("${card.label.toLowerCase()} 50 today") and it'll update.`
      } catch (err) {
        console.error('[create_kpi_card] failed', err)
        return `Couldn't add that card — try again in a sec.`
      }
    }

    case 'list_kpi_cards': {
      const cards = await listKpiCards(tenant.id, callerMember.id)
      if (!cards.length) {
        return `No KPI cards yet. Tell me your numbers (e.g. "100 dials, 25 convos, 5 sets today") and I'll offer to pin them to your dashboard.`
      }
      const today = new Date().toISOString().slice(0, 10)
      const lines: string[] = []
      for (const c of cards) {
        const { data: row } = await supabase
          .from('kpi_entries')
          .select('value')
          .eq('kpi_card_id', c.id)
          .eq('day', today)
          .maybeSingle()
        const todayVal = row ? Number(row.value) : 0
        const goalSuffix = c.goal_value ? ` / ${c.goal_value}` : ''
        lines.push(`• *${c.label}* — ${todayVal}${goalSuffix} today`)
      }
      return `📊 Your KPI cards:\n${lines.join('\n')}\n\nUpdate any of them by sending the number, or say "add X to my dashboard" for a new one.`
    }

    case 'feature_request': {
      const summary = (intent.summary ?? '').trim().slice(0, 500)
      const context = (intent.context ?? '').trim().slice(0, 4000) || null
      if (!summary) {
        return `Tell me what you want added — like "feature request: bot should log dial KPIs and chart them daily".`
      }
      try {
        await supabase.from('feature_requests').insert({
          rep_id: tenant.id,
          member_id: callerMember.id,
          source: 'mira',
          summary,
          context,
        })
      } catch (err) {
        console.error('[feature_request] db insert failed', err)
      }
      const tenantLabel = tenant.display_name || tenant.slug || tenant.id
      const res = await sendFeatureRequest({
        fromName: callerMember.display_name || 'Mira user',
        fromEmail: callerMember.email || null,
        workspace: tenantLabel,
        summary,
        context,
      }).catch((err) => {
        console.error('[feature_request] email failed', err)
        return { ok: false, error: 'send failed', to: '' }
      })

      if (!res.ok) {
        return `Saved your request — but the email to admin didn't go through. They'll still see it in the queue. (${res.error ?? 'unknown error'})`
      }
      return `📬 Got it — feature request logged and emailed to admin. They'll reach out if they need detail. (Reference: "${summary.slice(0, 60)}${summary.length > 60 ? '…' : ''}")`
    }

    case 'create_project': {
      const brief = (intent.brief ?? '').trim()
      if (!brief) {
        return `Tell me what to build — like "make a project to launch the Oracle campaign".`
      }
      try {
        const plan = await generateProjectPlan(brief, {
          repName: tenant.display_name,
          titleHint: intent.title ?? undefined,
        })
        if (plan.sections.length === 0) {
          return `I couldn't turn that into a plan — give me a bit more detail and I'll build it.`
        }
        const projectId = await createProjectFromPlan({
          repId: tenant.id,
          ownerMemberId,
          plan,
          sourceKind: 'prompt',
          sourceText: brief.slice(0, 50_000),
        })
        const taskCount = plan.sections.reduce((n, s) => n + s.tasks.length, 0)
        const root = getBrand(tenant.brand).rootDomain
        const url = `https://${tenant.slug}.${root}/dashboard/projects/${projectId}`
        return `📋 Built *${plan.name}* — ${plan.sections.length} sections, ${taskCount} tasks, all checkable. Open it: ${url}`
      } catch (err) {
        console.error('[create_project] failed', err)
        return `Something broke while building that project. Try again, or build it from the Projects tab.`
      }
    }

    case 'place_call': {
      // Trigger the AI dialer for an existing meeting.
      const contactName = (intent.contact_name ?? '').trim()
      if (!contactName) {
        return `Tell me who to dial — like "confirm my appointment with Betty at 2".`
      }
      const purpose = intent.purpose === 'reschedule' ? 'reschedule' : 'confirm'
      try {
        const { listUpcomingMeetingsForRep } = await import('@/lib/meetings')
        const upcoming = await listUpcomingMeetingsForRep(tenant.id, {
          fromIso: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // grace: -2h
          toIso: new Date(Date.now() + 14 * 86400_000).toISOString(),       // +14 days
          limit: 50,
        })
        const lower = contactName.toLowerCase()
        const candidates = upcoming.filter((m) =>
          (m.attendee_name ?? '').toLowerCase().includes(lower) ||
          (m.attendee_email ?? '').toLowerCase().includes(lower),
        )
        if (!candidates.length) {
          return `No upcoming meeting matching "${contactName}" in the next 2 weeks. Book the meeting first, then I can have the dialer call them.`
        }
        // If when_hint mentions a time, prefer the closest meeting to that hint.
        let target = candidates[0]
        if (intent.when_hint && candidates.length > 1) {
          const hint = intent.when_hint.toLowerCase()
          const dayMatch = candidates.find((m) => {
            const local = new Date(m.scheduled_at).toString().toLowerCase()
            return local.includes(hint) || hint.includes(local.split(' ')[0])
          })
          if (dayMatch) target = dayMatch
        }
        if (!target.phone) {
          return `Found the meeting with ${target.attendee_name ?? contactName} — but no phone number on file. Add their phone first.`
        }
        const dialer = await import('@/lib/voice/dialer')
        const result =
          purpose === 'reschedule'
            ? await dialer.dispatchRescheduleCall(target.id)
            : await dialer.dispatchConfirmCall(target.id)
        if (!result.ok) {
          const reasonMsg: Record<string, string> = {
            no_phone: 'no phone number on the meeting',
            wrong_status: 'meeting is no longer scheduled',
            dialer_addon_not_active: 'the AI dialer add-on is not active on this account',
            vapi_not_configured: 'Vapi is not set up yet — paste an API key on /admin/clients',
            no_confirm_assistant: 'the confirm assistant has not been provisioned yet',
            no_reschedule_assistant: 'the reschedule assistant has not been provisioned yet',
          }
          const friendly = reasonMsg[result.reason] || result.reason
          return `Couldn't fire the dial: ${friendly}.`
        }
        const when = new Date(target.scheduled_at).toLocaleString('en-US', {
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
        return `Dialer is ringing ${target.attendee_name ?? contactName} now (${when} appointment). I'll ping you with the outcome.`
      } catch (err) {
        console.error('[place_call] failed', err)
        return `Couldn't fire the dial: ${(err as Error).message}.`
      }
    }

    case 'product_help': {
      // Answer using Claude with the PRODUCT_KNOWLEDGE block already in the
      // system prompt. We just relay the topic + raw message back through
      // a quick generation call.
      try {
        const { generateText } = await import('@/lib/claude')
        const reply = await generateText({
          repName: callerMember.display_name,
          prompt: `The rep just asked about: "${intent.topic}"\n\nTheir exact message: "${rawUserText ?? intent.topic}"\n\nAnswer in 1-3 short sentences using ONLY the product knowledge in your system prompt. If the question is not covered there, say so plainly and suggest what they should ask the admin instead. Be direct, no filler.`,
          maxTokens: 280,
        })
        return reply.trim() || `Not sure about that one — ask your admin or check /dashboard.`
      } catch (err) {
        console.error('[product_help] generation failed', err)
        return `Hit an error answering that. Try again or ask your admin.`
      }
    }

    case 'question': {
      return intent.reply
    }

    case 'move_lead_stage': {
      let stages = await findStageByNameForTenant(tenant.id, intent.stage_name)

      // Autonomy: if the rep hasn't set up a pipeline yet, just build a
      // sensible default + the stage they named. They never have to go to
      // the dashboard first.
      if (!stages) {
        const { getPipelinesForRep, createPipeline, addStage } = await import('@/lib/pipelines')
        const existing = await getPipelinesForRep(tenant.id)
        if (!existing.length) {
          // Fresh account → bootstrap a default pipeline + ensure the named stage exists.
          const newPipeline = await createPipeline(tenant.id, 'Sales Pipeline')
          const wantedLower = intent.stage_name.trim().toLowerCase()
          const matched = newPipeline.stages.find((s) => s.name.toLowerCase() === wantedLower)
          if (matched) {
            stages = { ...matched, pipeline_id: newPipeline.id }
          } else {
            const added = await addStage(newPipeline.id, tenant.id, intent.stage_name.trim())
            stages = { ...added, pipeline_id: newPipeline.id }
          }
        } else {
          // They have at least one pipeline but no matching stage — list options.
          const allStageNames = existing.flatMap((p) => p.stages.map((s) => s.name))
          if (!allStageNames.length) {
            return `❓ Your pipeline has no stages yet. Just paste a list and say "build a pipeline to track these" and I'll set it up for you.`
          }
          return `❓ Couldn't find a stage matching "*${intent.stage_name}*". Your stages: ${allStageNames.join(', ')}`
        }
      }

      const lead =
        knownLeads.find((l) => l.name.toLowerCase() === intent.lead_name.toLowerCase()) ??
        knownLeads.find((l) => l.name.toLowerCase().includes(intent.lead_name.toLowerCase()))
      if (!lead) {
        return `❓ Couldn't find a lead matching "*${intent.lead_name}*".`
      }
      const { moveLeadToStage } = await import('@/lib/pipelines')
      const { crmPushed, crmSource } = await moveLeadToStage(
        lead.id,
        tenant.id,
        stages.pipeline_id,
        stages.id,
      )

      // GHL enrichment: add note + enroll in stage workflow. Best-effort — never throws.
      if (crmPushed && crmSource === 'ghl') {
        try {
          const { makeAgentCRMForRep, enrollContactInStageWorkflow } = await import('@/lib/agentcrm')
          const crm = await makeAgentCRMForRep(tenant.id)
          if (crm) {
            // Resolve GHL contact ID. Priority:
            //   1. crm_contact_id (cached contact ID from a previous mirrorLeadToGHL call)
            //   2. getOpportunity(crm_object_id).contactId  ← crm_object_id is the *opportunity* ID
            //   3. searchContacts by email or phone
            const { data: leadRow } = await supabase
              .from('leads')
              .select('crm_object_id, crm_contact_id, email, phone')
              .eq('id', lead.id)
              .maybeSingle()

            let contactId = (leadRow?.crm_contact_id as string | null | undefined) ?? null

            if (!contactId && leadRow?.crm_object_id) {
              const opp = await crm
                .getOpportunity(leadRow.crm_object_id as string)
                .catch(() => null)
              contactId = (opp?.contactId as string | null | undefined) ?? null
              // Cache it so future calls skip this lookup
              if (contactId) {
                void supabase
                  .from('leads')
                  .update({ crm_contact_id: contactId })
                  .eq('id', lead.id)
                  .eq('rep_id', tenant.id)
              }
            }

            if (!contactId) {
              const q = (leadRow?.email as string) || (leadRow?.phone as string) || ''
              if (q) {
                const matches = await crm.searchContacts(q).catch(() => [])
                contactId = matches[0]?.id ?? null
              }
            }

            if (contactId) {
              if (intent.note) {
                await crm
                  .addNote(contactId, `[${brandLabel(tenant)}] ${intent.note}`)
                  .catch((err) => console.error('[move_lead_stage] addNote failed', err))
              }
              // Enroll in stage-specific GHL workflow if one is configured
              await enrollContactInStageWorkflow(tenant.id, contactId, stages.name)
            }
          }
        } catch (err) {
          console.error('[move_lead_stage] GHL enrichment failed', err)
        }
      }

      const crmNote = crmPushed
        ? ` _(also updated in ${crmSource?.toUpperCase()} — stage move will fire any "${stages.name}" workflows you have configured)_`
        : ''
      return `Moved *${lead.name}* → *${stages.name}*.${crmNote}`
    }

    case 'send_email': {
      return handleSendEmail({ intent, tenant, callerMember })
    }

    case 'send_sms': {
      return handleSendSms({ intent, tenant })
    }

    case 'bulk_import_leads': {
      // Deep parse the raw user message to pull out every prospect.
      if (!rawUserText || rawUserText.trim().length < 80) {
        return `❓ I couldn't see the prospect list — paste it in one message and I'll import everyone.`
      }
      const { extractBulkLeads } = await import('@/lib/claude')
      const { getPipelinesForRep } = await import('@/lib/pipelines')

      const parsed = await extractBulkLeads(rawUserText, tenant.display_name).catch((err) => {
        console.error('[bulk_import] extractor failed', err)
        return null
      })
      if (!parsed || !parsed.leads.length) {
        return `❓ I couldn't extract any prospects from that. Make sure each person has a name on its own line.`
      }

      const wantedName = (intent.pipeline_name || parsed.pipeline_name || 'Sales Pipeline').trim()
      const suggestedKind = (intent.pipeline_kind ?? 'sales') as
        | 'sales'
        | 'recruiting'
        | 'team'
        | 'project'
        | 'custom'

      // If they already have a pipeline with this exact name, skip the kind
      // prompt and go straight to import (kind is already locked in).
      const existing = await getPipelinesForRep(tenant.id)
      const exactMatch = existing.find((p) => p.name.toLowerCase() === wantedName.toLowerCase())
      if (exactMatch) {
        const message = await runBulkImport({
          tenant,
          ownerMemberId,
          parsedLeads: parsed.leads,
          suggestedStages: parsed.suggested_stages,
          wantedName,
          kind: (exactMatch.kind ?? 'sales') as 'sales' | 'recruiting' | 'team' | 'project' | 'custom',
          brainItemQueue,
          ambiguousAgainst: [],
        })
        return message
      }

      // No exact match → create a new board of the suggested kind and flag
      // any existing boards of the same kind so the rep can merge if needed.
      const sameKindBoards = existing.filter((p) => (p.kind ?? 'sales') === suggestedKind)
      return runBulkImport({
        tenant,
        ownerMemberId,
        parsedLeads: parsed.leads,
        suggestedStages: parsed.suggested_stages,
        wantedName,
        kind: suggestedKind,
        brainItemQueue,
        ambiguousAgainst: sameKindBoards,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// send_email — sends from the rep's connected Gmail account
// ---------------------------------------------------------------------------

async function handleSendEmail(args: {
  intent: { kind: 'send_email'; lead_name: string; subject: string; body: string; to_email?: string | null; recipient_kind?: 'lead' | 'partner' | 'member' | null }
  tenant: { id: string; display_name: string | null }
  callerMember: { id: string; display_name: string | null; email: string | null }
}): Promise<string> {
  const { intent, tenant, callerMember } = args
  const { sendGmailMessage, getTokensFor } = await import('@/lib/google')

  const leadName = (intent.lead_name ?? '').trim()
  const subject = (intent.subject ?? '').trim()
  const body = (intent.body ?? '').trim()

  if (!leadName || !subject || !body) {
    return `Tell me the subject and body — like "email Dana, subject: Pricing Follow-Up, body: Hey Dana, just checking in on the proposal…"`
  }

  // Resolve email address: prefer explicit override, then lead → partner → team member.
  let toEmail = (intent.to_email ?? '').trim() || null
  let recipient: Awaited<ReturnType<typeof import('@/lib/emailRecipients').resolveEmailRecipient>> = null
  if (!toEmail) {
    const { resolveEmailRecipient } = await import('@/lib/emailRecipients')
    recipient = await resolveEmailRecipient(tenant.id, leadName, intent.recipient_kind ?? null)
    toEmail = recipient?.email ?? null
    if (!toEmail) {
      return `I don't have an email address for *${leadName}*. Send me their email and I'll use it: \`${leadName}'s email is …\``
    }
  }

  // Basic email address sanity check
  if (!toEmail.includes('@') || !toEmail.includes('.')) {
    return `That doesn't look like a valid email address: \`${toEmail}\`. Double-check and try again.`
  }

  // Check Gmail is connected + has the gmail.send scope. ONLY the caller's
  // own mailbox (owner 10-09): never another member's or a former member's
  // shared account.
  const { pickSenderAccount } = await import('@/lib/partners')
  const { account: senderBox } = await pickSenderAccount(tenant.id, callerMember.id)
  const tokens = senderBox ? await getTokensFor(tenant.id, senderBox.memberId, senderBox.accountId) : null
  if (!senderBox || !tokens) {
    return `Your Google account isn't connected. Go to /dashboard/integrations and connect Google first — then I can send email from your Gmail.`
  }
  // If scope string is available, verify it contains gmail.send.
  if (tokens.scope && !tokens.scope.includes('gmail.send')) {
    return `Your Google connection doesn't have email-send permission yet. Go to /dashboard/integrations, disconnect Google, then reconnect — you'll see a new "Send email" permission to approve.`
  }

  const result = await sendGmailMessage(tenant.id, {
    to: toEmail,
    subject,
    body,
    fromName: callerMember.display_name ?? undefined,
    memberId: senderBox.memberId,
    accountId: senderBox.accountId,
  })

  if (result.ok && recipient?.kind === 'partner') {
    // Partner sends land in the same log the Partners page reads.
    try {
      const { recordPartnerAction } = await import('@/lib/partners')
      await recordPartnerAction({ repId: tenant.id, partnerId: recipient.id, kind: 'email', subject, body, status: 'sent', sentTo: toEmail, channel: 'gmail', providerId: result.messageId ?? null, createdBy: callerMember.id })
    } catch (e) {
      console.error('[send_email] partner log failed', e)
    }
  }

  if (!result.ok) {
    if (result.error === 'gmail_scope_missing') {
      return `Your Google connection needs the email-send permission. Go to /dashboard/integrations, disconnect Google, then reconnect to approve it.`
    }
    if (result.error === 'google_not_connected') {
      return `Google isn't connected. Head to /dashboard/integrations and connect your account first.`
    }
    console.error('[send_email] Gmail send failed', result.error)
    return `The email didn't go through (${result.error ?? 'unknown error'}). Try again or check your Google connection at /dashboard/integrations.`
  }

  return `Email sent to *${leadName}* (${toEmail}).\nSubject: _${subject}_`
}

// ---------------------------------------------------------------------------
// send_sms — sends via the tenant's Twilio account
// ---------------------------------------------------------------------------

async function handleSendSms(args: {
  intent: { kind: 'send_sms'; lead_name: string; message: string; to_phone?: string | null }
  tenant: { id: string }
}): Promise<string> {
  const { intent, tenant } = args

  const leadName = (intent.lead_name ?? '').trim()
  const message = (intent.message ?? '').trim()

  if (!leadName || !message) {
    return `Tell me who to text and what to say — like "text Dana: hey, just checking in on the proposal"`
  }

  // Resolve phone number: prefer explicit override, then lead record.
  // Also capture email + cached crm_contact_id for GHL fallbacks.
  let toPhone = (intent.to_phone ?? '').trim() || null
  let leadEmail: string | null = null
  let cachedGhlContactId: string | null = null

  if (!toPhone) {
    const { data: leadRow } = await supabase
      .from('leads')
      .select('phone, email, name, crm_contact_id')
      .eq('rep_id', tenant.id)
      .ilike('name', `%${leadName}%`)
      .limit(1)
      .maybeSingle()
    toPhone = (leadRow?.phone as string | null | undefined) ?? null
    leadEmail = (leadRow?.email as string | null | undefined) ?? null
    cachedGhlContactId = (leadRow?.crm_contact_id as string | null | undefined) ?? null
    if (!toPhone) {
      return `I don't have a phone number for *${leadName}*. Send me their number and I'll save it: \`${leadName}'s phone is …\``
    }
  }

  // ── Path 1: GHL — send through GHL's conversation inbox so it shows up
  //   in GHL and fires any "SMS sent" or "conversation message sent" workflows.
  try {
    const { makeAgentCRMForRep } = await import('@/lib/agentcrm')
    const crm = await makeAgentCRMForRep(tenant.id)
    if (crm) {
      // Use cached contact ID, then phone lookup, then email lookup
      let ghlContactId = cachedGhlContactId
      if (!ghlContactId) {
        ghlContactId = await crm.findContactByPhone(toPhone)
      }
      if (!ghlContactId && leadEmail) {
        const hits = await crm.searchContacts(leadEmail).catch(() => [])
        ghlContactId = hits[0]?.id ?? null
      }

      if (ghlContactId) {
        await crm.sendConversationMessage(ghlContactId, message)
        const preview = message.length > 100 ? message.slice(0, 100) + '…' : message
        return `Text sent to *${leadName}* via GHL (${toPhone}).\n_${preview}_`
      }
      // GHL connected but contact not found — fall through to Twilio
      console.warn('[send_sms] GHL contact not found for', toPhone, '— falling back to Twilio')
    }
  } catch (err) {
    // GHL send failed — log and fall through to Twilio
    console.error('[send_sms] GHL send error, falling back to Twilio', err)
  }

  // ── Path 2: Twilio direct send
  const { sendSms } = await import('@/lib/sms')
  const result = await sendSms(tenant.id, { to: toPhone, body: message })

  if (!result.ok) {
    const reason = result.reason ?? 'unknown'
    if (reason === 'twilio_not_configured') {
      return `Neither GHL nor Twilio is configured. Ask your admin to set up SMS at /admin/clients.`
    }
    if (reason === 'twilio_creds_incomplete') {
      return `Twilio is configured but missing credentials. Ask your admin to complete the Twilio setup.`
    }
    if (reason === 'invalid_to_number') {
      return `The phone number for *${leadName}* doesn't look right (\`${toPhone}\`). Update it and try again.`
    }
    console.error('[send_sms] Twilio send failed', reason)
    return `Text didn't send (${reason}). Check your SMS setup or try again.`
  }

  const preview = message.length > 100 ? message.slice(0, 100) + '…' : message
  return `Text sent to *${leadName}* (${toPhone}).\n_${preview}_`
}

/**
 * Execute the bulk import once we know the board kind. For 'sales' boards
 * the cards are written to the `leads` table (legacy + CRM mirror). For
 * every other kind we write generic cards to `pipeline_items` so the
 * recruiting/team/project boards never pollute the sales CRM.
 *
 * Both paths return the same success message shape.
 */
async function runBulkImport(args: {
  tenant: Tenant
  ownerMemberId: string | null
  parsedLeads: Array<{
    name: string
    company?: string | null
    email?: string | null
    phone?: string | null
    state?: string | null
    age?: number | null
    status?: string | null
    notes?: string | null
    deal_value?: number | null
    action_items?: string[]
    stage_name?: string | null
  }>
  suggestedStages: string[]
  wantedName: string
  kind: 'sales' | 'recruiting' | 'team' | 'project' | 'custom'
  brainItemQueue: Array<{
    item_type: 'task' | 'goal' | 'idea' | 'plan' | 'note'
    content: string
    priority?: 'low' | 'normal' | 'high'
    horizon?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none' | null
    due_date?: string | null
    lead_id?: string | null
  }>
  ambiguousAgainst: Array<{ name: string }>
}): Promise<string> {
  const {
    tenant,
    ownerMemberId,
    parsedLeads,
    suggestedStages,
    wantedName,
    kind,
    brainItemQueue,
    ambiguousAgainst,
  } = args
  const {
    getPipelinesForRep,
    createPipeline,
    addStage,
    deleteStage,
    moveLeadToStage,
    createItem,
  } = await import('@/lib/pipelines')

  // Re-check existing in case state changed between prompt and confirm.
  const existing = await getPipelinesForRep(tenant.id)
  let pipeline = existing.find((p) => p.name.toLowerCase() === wantedName.toLowerCase())

  if (!pipeline) {
    pipeline = await createPipeline(tenant.id, wantedName, { kind })
    // Replace seeded defaults with the rep's mentioned stages, if any.
    if (suggestedStages.length) {
      for (const s of pipeline.stages) {
        await deleteStage(s.id, tenant.id).catch(() => null)
      }
      const newStages = []
      for (const stageName of suggestedStages) {
        const s = await addStage(pipeline.id, tenant.id, stageName)
        newStages.push(s)
      }
      pipeline = { ...pipeline, stages: newStages }
    }
  } else {
    // Existing pipeline — append any missing stages.
    const have = new Set(pipeline.stages.map((s) => s.name.toLowerCase()))
    for (const stageName of suggestedStages) {
      if (!have.has(stageName.toLowerCase())) {
        const s = await addStage(pipeline.id, tenant.id, stageName)
        pipeline.stages.push(s)
      }
    }
  }

  const stageByName = new Map(pipeline.stages.map((s) => [s.name.toLowerCase(), s]))
  const defaultStage = pipeline.stages[0]
  let created = 0

  for (const p of parsedLeads) {
    try {
      const noteParts: string[] = []
      if (p.notes) noteParts.push(p.notes.trim())
      if (p.action_items?.length) {
        noteParts.push(`Action items:\n- ${p.action_items.join('\n- ')}`)
      }
      if (p.phone) noteParts.push(`Phone: ${p.phone}`)
      if (p.state) noteParts.push(`State: ${p.state}`)
      if (typeof p.age === 'number') noteParts.push(`Age: ${p.age}`)
      const combinedNotes = noteParts.join('\n\n') || null

      const stage =
        (p.stage_name && stageByName.get(p.stage_name.toLowerCase())) || defaultStage

      if (kind === 'sales') {
        // Sales path: write to leads (legacy + CRM mirror compatible).
        const lead = await upsertLead({
          repId: tenant.id,
          name: p.name,
          company: p.company ?? null,
          email: p.email ?? null,
          status: (p.status as LeadStatus) || 'warm',
          notes: combinedNotes,
          source: 'mira_bulk_import',
          ownerMemberId,
        })
        if (typeof p.deal_value === 'number' && p.deal_value > 0) {
          await supabase
            .from('leads')
            .update({ deal_value: p.deal_value, deal_currency: 'USD' })
            .eq('id', lead.id)
            .eq('rep_id', tenant.id)
        }
        if (stage) {
          await moveLeadToStage(lead.id, tenant.id, pipeline.id, stage.id).catch(() => null)
        }
      } else {
        // Non-sales path: write generic items so the recruiting/team/project
        // boards have proper rendering on the kanban.
        const subtitleBits: string[] = []
        if (p.company) subtitleBits.push(p.company)
        if (p.phone) subtitleBits.push(p.phone)
        if (p.email) subtitleBits.push(p.email)
        const subtitle = subtitleBits.join(' · ') || null
        await createItem(tenant.id, pipeline.id, {
          title: p.name,
          subtitle,
          notes: combinedNotes,
          value: typeof p.deal_value === 'number' ? p.deal_value : null,
          pipeline_stage_id: stage?.id ?? null,
          owner_member_id: ownerMemberId,
          metadata: {
            source: 'mira_bulk_import',
            email: p.email ?? null,
            phone: p.phone ?? null,
            state: p.state ?? null,
            age: p.age ?? null,
            status_hint: p.status ?? null,
          },
        })
      }

      // Per-person action items always become brain_items so the rep has a
      // task list regardless of what kind of board this is.
      if (p.action_items?.length) {
        for (const ai of p.action_items) {
          brainItemQueue.push({
            item_type: 'task',
            content: `${p.name}: ${ai}`,
            priority: p.status === 'hot' ? 'high' : 'normal',
            horizon: 'week',
            due_date: null,
          })
        }
      }
      created++
    } catch (err) {
      console.error('[bulk_import] failed item', p.name, err)
    }
  }

  const stageList = pipeline.stages.map((s) => s.name).join(' → ')
  const kindLabel: Record<typeof kind, string> = {
    sales: 'prospects',
    recruiting: 'candidates',
    team: 'teammates',
    project: 'tasks',
    custom: 'cards',
  }
  const noun = kindLabel[kind]
  const heads_up =
    ambiguousAgainst.length > 0
      ? `\n\nℹ️ Heads up — you already have boards: *${ambiguousAgainst.map((p) => p.name).join('*, *')}*. I created *${pipeline.name}* as a new one.`
      : ''

  const tipLine =
    kind === 'sales'
      ? '\n\n💡 *Try:* "Move Bryant to Quoted" · "Bryant is a $15k deal" · "Pipeline" → see board'
      : '\n\n💡 *Try:* drag cards between stages on /dashboard/pipeline, or "+ Add card" inside any stage'

  return `✅ Imported *${created}* ${noun} into *${pipeline.name}*${kind !== 'sales' ? ` (${kind} board)` : ''}.\nStages: ${stageList}\n\nView → /dashboard/pipeline${heads_up}${tipLine}`
}

/**
 * Fetch the data for a report and ask Claude to summarize it.
 */
async function runReport(
  reportType: string,
  leadName: string | null,
  tenant: Tenant,
  callerMemberId: string | null = null,
): Promise<string> {
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)

  if (reportType === 'pipeline') {
    const leads = await getAllLeads(tenant.id)
    const counts = {
      hot: leads.filter((l) => l.status === 'hot').length,
      warm: leads.filter((l) => l.status === 'warm').length,
      cold: leads.filter((l) => l.status === 'cold').length,
      dormant: leads.filter((l) => l.status === 'dormant').length,
      total: leads.length,
    }
    const hottest = leads
      .filter((l) => l.status === 'hot' || l.status === 'warm')
      .slice(0, 8)
      .map((l) => ({
        name: l.name,
        company: l.company,
        status: l.status,
        last_contact: l.last_contact,
      }))
    return generateReport('pipeline', { counts, hottest, today: todayIso }, tenant.display_name)
  }

  if (reportType === 'today' || reportType === 'week') {
    const leads = await getAllLeads(tenant.id)
    const startIso =
      reportType === 'today'
        ? new Date(todayIso + 'T00:00:00Z').toISOString()
        : new Date(Date.now() - 7 * 86400_000).toISOString()
    const stats = await getCallStats(tenant.id, startIso)
    const windowEnd = new Date(Date.now() + (reportType === 'today' ? 1 : 7) * 86400_000).toISOString()
    const { listUpcomingMeetingsForRep: listMeetings } = await import('@/lib/meetings')
    const [gcalEventsRaw, dbMeetings] = await Promise.all([
      listUpcomingEvents(tenant.id, { fromIso: new Date().toISOString(), toIso: windowEnd, maxResults: 10, memberId: callerMemberId }),
      listMeetings(tenant.id, { fromIso: new Date().toISOString(), toIso: windowEnd, limit: 10 }),
    ])
    const coveredIds = new Set(dbMeetings.map((m) => m.source_event_id).filter(Boolean))
    const upcomingEvents = [
      ...dbMeetings.map((m) => ({ summary: m.title ?? 'Booked call', start: m.scheduled_at, attendee: m.attendee_name, status: m.status })),
      ...(gcalEventsRaw ?? []).filter((e) => !coveredIds.has(e.id)).map((e) => ({ summary: e.summary, start: e.start, attendees: (e.attendees ?? []).map((a) => a.email) })),
    ]
    const targets = await refreshTargetProgress(tenant.id)
    return generateReport(
      reportType,
      {
        leadCounts: {
          hot: leads.filter((l) => l.status === 'hot').length,
          warm: leads.filter((l) => l.status === 'warm').length,
        },
        callStats: stats,
        upcomingEvents: upcomingEvents.slice(0, 8),
        activeTargets: targets.map((t) => ({
          metric: t.metric,
          target: t.target_value,
          current: t.current_value,
          period: t.period_type,
        })),
      },
      tenant.display_name,
    )
  }

  if (reportType === 'calendar') {
    const toIso30d = new Date(Date.now() + 30 * 86400_000).toISOString()
    const fromIsoNow = new Date().toISOString()

    // Always pull from the meetings table — this is the source of truth for
    // booked calls (Cal.com, GHL, manual). Google Calendar is supplemental.
    const { listUpcomingMeetingsForRep } = await import('@/lib/meetings')
    const [dbMeetings, gcalEvents] = await Promise.all([
      listUpcomingMeetingsForRep(tenant.id, { fromIso: fromIsoNow, toIso: toIso30d, limit: 20 }),
      listUpcomingEvents(tenant.id, { maxResults: 15, memberId: callerMemberId, toIso: toIso30d }),
    ])

    // Build the merged event list. DB meetings go first (they are the booked
    // calls). Then add any GCal events whose event ID isn't already covered.
    const coveredGcalIds = new Set(dbMeetings.map((m) => m.source_event_id).filter(Boolean))
    const gcalOnly = (gcalEvents ?? []).filter((e) => !coveredGcalIds.has(e.id))

    const mergedEvents = [
      ...dbMeetings.map((m) => ({
        summary: m.title ?? 'Booked call',
        start: m.scheduled_at,
        attendee: m.attendee_name,
        ...(m.meeting_url ? { join_link: m.meeting_url } : {}),
        status: m.status,
      })),
      ...gcalOnly.map((e) => ({
        summary: e.summary,
        start: e.start,
        end: e.end,
        attendees: (e.attendees ?? []).map((a) => a.email),
        ...(e.conferenceLink ? { join_link: e.conferenceLink } : {}),
        ...(e.location ? { location: e.location } : {}),
        ...(e.htmlLink ? { calendar_link: e.htmlLink } : {}),
      })),
    ]

    if (mergedEvents.length === 0 && gcalEvents === null) {
      return "I don't see any booked calls in your schedule, and Google Calendar isn't connected yet. Connect it from your dashboard to give me the full picture."
    }

    return generateReport('calendar', { events: mergedEvents }, tenant.display_name)
  }

  if (reportType === 'goals' || reportType === 'metrics') {
    const targets = await refreshTargetProgress(tenant.id)
    const weekStart = new Date(Date.now() - 7 * 86400_000).toISOString()
    const stats = await getCallStats(tenant.id, weekStart)
    return generateReport(
      reportType,
      {
        activeTargets: targets.map((t) => ({
          metric: t.metric,
          period: t.period_type,
          target: t.target_value,
          current: t.current_value,
          progress_pct: t.target_value > 0 ? Math.round((100 * t.current_value) / t.target_value) : 0,
          notes: t.notes,
        })),
        last7Days: stats,
      },
      tenant.display_name,
    )
  }

  if (reportType === 'lead_history' && leadName) {
    const leads = await getRecentLeadNames(tenant.id, 200)
    const lead =
      leads.find((l) => l.name.toLowerCase() === leadName.toLowerCase()) ??
      leads.find((l) => l.name.toLowerCase().includes(leadName.toLowerCase()))
    if (!lead) {
      return `Couldn't find *${leadName}* in your prospects yet.`
    }
    const calls = await getCallsForLead(tenant.id, lead.id)
    return generateReport(
      'lead_history',
      {
        lead: {
          name: lead.name,
          company: lead.company,
          status: lead.status,
          last_contact: lead.last_contact,
          notes: lead.notes,
        },
        calls: calls.slice(0, 10).map((c) => ({
          when: c.occurred_at,
          outcome: c.outcome,
          summary: c.summary,
          next_step: c.next_step,
        })),
      },
      tenant.display_name,
    )
  }

  // Fallback summary
  const recentCalls = await getRecentCalls(tenant.id, 10)
  const targets = await getActiveTargets(tenant.id)
  return generateReport('summary', { recentCalls, targets }, tenant.display_name)
}

function findLeadInList(leads: Lead[], query: string): Lead | null {
  if (!query) return null
  const q = query.trim().toLowerCase()
  if (!q) return null
  return (
    leads.find((l) => l.name.toLowerCase() === q) ||
    leads.find((l) => (l.company || '').toLowerCase() === q) ||
    leads.find((l) => l.name.toLowerCase().includes(q)) ||
    leads.find((l) => (l.company || '').toLowerCase().includes(q)) ||
    null
  )
}

function matchMemberByName(
  members: Member[],
  query: string,
  excludeId: string | null,
): Member | null {
  if (!query) return null
  const q = query.trim().toLowerCase()
  if (!q) return null
  const pool = members.filter(
    (m) => (excludeId ? m.id !== excludeId : true) && m.is_active !== false,
  )
  return (
    pool.find((m) => (m.display_name || '').toLowerCase() === q) ||
    pool.find((m) => (m.display_name || '').toLowerCase().includes(q)) ||
    pool.find((m) => (m.email || '').toLowerCase().split('@')[0] === q) ||
    pool.find((m) => {
      const first = (m.display_name || '').split(/\s+/)[0]?.toLowerCase()
      return first && first === q
    }) ||
    null
  )
}

// ── Calendar confirmation helpers ─────────────────────────────────────────

function formatLocalDateTime(iso: string, timeZone: string): string {
  if (!iso) return '(no time)'
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toLocaleString()
  }
}
