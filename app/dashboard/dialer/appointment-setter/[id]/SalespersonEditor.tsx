'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AiSalesperson, AiSalespersonObjection } from '@/types'

type Tab =
  | 'overview'
  | 'persona'
  | 'call_script'
  | 'sms'
  | 'email'
  | 'objections'
  | 'schedule'
  | 'calendar'
  | 'lead_rules'
  | 'integrations'
  | 'analytics'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview',     label: 'Overview' },
  { id: 'persona',      label: 'Persona' },
  { id: 'call_script',  label: 'Call Script' },
  { id: 'sms',          label: 'SMS' },
  { id: 'email',        label: 'Email' },
  { id: 'objections',   label: 'Objections' },
  { id: 'schedule',     label: 'Schedule' },
  { id: 'calendar',     label: 'Calendar' },
  { id: 'lead_rules',   label: 'Lead Rules' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'analytics',    label: 'Analytics' },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function SalespersonEditor({ initial }: { initial: AiSalesperson }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [item, setItem] = useState<AiSalesperson>(initial)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof AiSalesperson>(key: K, value: AiSalesperson[K]) {
    setItem((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/me/ai-salespeople/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: item.name,
          status: item.status,
          product_category: item.product_category,
          appointment_type: item.appointment_type,
          appointment_duration_min: item.appointment_duration_min,
          product_intent: item.product_intent,
          voice_persona: item.voice_persona,
          call_script: item.call_script,
          sms_scripts: item.sms_scripts,
          email_templates: item.email_templates,
          objection_responses: item.objection_responses,
          schedule: item.schedule,
          calendar: item.calendar,
          crm_push: item.crm_push,
          phone_number: item.phone_number,
          phone_provider: item.phone_provider,
        }),
      })
      const j = await res.json()
      if (!res.ok) {
        setErr((j as { error?: string }).error ?? 'Save failed')
        return
      }
      const updated = (j as { item?: AiSalesperson }).item
      if (updated) setItem(updated)
      setSavedAt(new Date().toLocaleTimeString())
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section style={{ margin: '0 24px 1.5rem' }}>
      {/* Status + save bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '10px 14px',
        marginBottom: 12,
        position: 'sticky',
        top: 0,
        zIndex: 5,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            value={item.name}
            onChange={(e) => set('name', e.target.value)}
            style={{ fontSize: 16, fontWeight: 700, border: '1px solid transparent', padding: 4, borderRadius: 4, minWidth: 240 }}
          />
          <select
            value={item.status}
            onChange={(e) => set('status', e.target.value as AiSalesperson['status'])}
            style={fieldStyle({ width: 120 })}
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {err && <span style={{ color: '#b91c1c', fontSize: 13 }}>{err}</span>}
          {savedAt && !err && <span style={{ color: '#16a34a', fontSize: 13 }}>Saved {savedAt}</span>}
          <button onClick={save} disabled={saving} style={{
            background: 'var(--red, #ff2800)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 16px',
            fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer',
          }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14, borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? 'var(--red, #ff2800)' : 'transparent',
              color: tab === t.id ? '#fff' : '#374151',
              border: tab === t.id ? 'none' : '1px solid #e5e7eb',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
        {tab === 'overview' && <OverviewTab item={item} set={set} />}
        {tab === 'persona' && <PersonaTab item={item} set={set} />}
        {tab === 'call_script' && <CallScriptTab item={item} set={set} />}
        {tab === 'sms' && <SmsTab item={item} set={set} />}
        {tab === 'email' && <EmailTab item={item} set={set} />}
        {tab === 'objections' && <ObjectionsTab item={item} set={set} />}
        {tab === 'schedule' && <ScheduleTab item={item} set={set} />}
        {tab === 'calendar' && <CalendarTab item={item} set={set} />}
        {tab === 'lead_rules' && <LeadRulesTab item={item} set={set} />}
        {tab === 'integrations' && <IntegrationsTab item={item} set={set} />}
        {tab === 'analytics' && <AnalyticsTab item={item} />}
      </div>
    </section>
  )
}

// ────────────────────────────── Tab components ──────────────────────────────

type SetFn = <K extends keyof AiSalesperson>(key: K, value: AiSalesperson[K]) => void

function OverviewTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  return (
    <div style={col()}>
      <Field label="Product category">
        <input
          value={item.product_category ?? ''}
          onChange={(e) => set('product_category', e.target.value || null)}
          placeholder="e.g. Mortgage, Solar, B2B SaaS"
          style={fieldStyle()}
        />
      </Field>
      <Field label="Appointment type">
        <select
          value={item.appointment_type ?? 'phone'}
          onChange={(e) => set('appointment_type', e.target.value)}
          style={fieldStyle()}
        >
          <option value="phone">Phone call</option>
          <option value="video">Video call</option>
          <option value="in_person">In person</option>
        </select>
      </Field>
      <Field label="Appointment duration (minutes)">
        <input
          type="number"
          value={item.appointment_duration_min ?? 30}
          onChange={(e) => set('appointment_duration_min', Number(e.target.value) || 30)}
          style={fieldStyle({ width: 120 })}
        />
      </Field>
      <Field label="Outbound phone number override (optional)">
        <input
          value={item.phone_number ?? ''}
          onChange={(e) => set('phone_number', e.target.value || null)}
          placeholder="+15551234567 — leave blank to use rep number"
          style={fieldStyle()}
        />
      </Field>
      <Field label="Phone provider">
        <select
          value={item.phone_provider ?? ''}
          onChange={(e) => set('phone_provider', (e.target.value || null) as AiSalesperson['phone_provider'])}
          style={fieldStyle({ width: 200 })}
        >
          <option value="">— inherit from rep —</option>
          <option value="revring">RevRing</option>
          <option value="twilio">Twilio</option>
        </select>
      </Field>
    </div>
  )
}

function PersonaTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const p = item.voice_persona ?? {}
  const pi = item.product_intent ?? {}
  const upd = (patch: Partial<typeof p>) => set('voice_persona', { ...p, ...patch })
  const updP = (patch: Partial<typeof pi>) => set('product_intent', { ...pi, ...patch })
  return (
    <div style={col()}>
      <h3 style={h3()}>Voice persona</h3>
      <Field label="AI name (what the lead hears)">
        <input value={p.ai_name ?? ''} onChange={(e) => upd({ ai_name: e.target.value })} style={fieldStyle()} />
      </Field>
      <Field label="Role title">
        <input value={p.role_title ?? ''} onChange={(e) => upd({ role_title: e.target.value })} placeholder="e.g. Senior Loan Specialist" style={fieldStyle()} />
      </Field>
      <Field label="Tone">
        <select value={p.tone ?? 'warm'} onChange={(e) => upd({ tone: e.target.value })} style={fieldStyle({ width: 220 })}>
          <option value="warm">Warm</option>
          <option value="professional">Professional</option>
          <option value="energetic">Energetic</option>
          <option value="consultative">Consultative</option>
          <option value="direct">Direct</option>
        </select>
      </Field>
      <Field label="Voice ID (provider-specific)">
        <input value={p.voice_id ?? ''} onChange={(e) => upd({ voice_id: e.target.value })} placeholder="Optional — overrides default voice" style={fieldStyle()} />
      </Field>
      <Field label="Opening line">
        <textarea value={p.opener ?? ''} onChange={(e) => upd({ opener: e.target.value })} rows={2} style={fieldStyle()} />
      </Field>

      <h3 style={h3()}>Product</h3>
      <Field label="Product name">
        <input value={pi.name ?? ''} onChange={(e) => updP({ name: e.target.value })} style={fieldStyle()} />
      </Field>
      <Field label="What it does (used in pitch)">
        <textarea value={pi.explanation ?? ''} onChange={(e) => updP({ explanation: e.target.value })} rows={3} style={fieldStyle()} />
      </Field>
      <Field label="Audience">
        <input value={pi.audience ?? ''} onChange={(e) => updP({ audience: e.target.value })} placeholder="Who is this for?" style={fieldStyle()} />
      </Field>
      <Field label="Why the lead opted in (compliance reason)">
        <input value={pi.opt_in_reason ?? ''} onChange={(e) => updP({ opt_in_reason: e.target.value })} style={fieldStyle()} />
      </Field>
      <Field label="Talking points">
        <textarea value={pi.talking_points ?? ''} onChange={(e) => updP({ talking_points: e.target.value })} rows={3} style={fieldStyle()} />
      </Field>
      <Field label="Things to avoid">
        <textarea value={pi.avoid ?? ''} onChange={(e) => updP({ avoid: e.target.value })} rows={2} style={fieldStyle()} />
      </Field>
    </div>
  )
}

function CallScriptTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const cs = item.call_script ?? {}
  const upd = (patch: Partial<typeof cs>) => set('call_script', { ...cs, ...patch })
  const qa = cs.qualifying ?? []
  return (
    <div style={col()}>
      <Field label="Opening">
        <textarea value={cs.opening ?? ''} onChange={(e) => upd({ opening: e.target.value })} rows={3} style={fieldStyle()} />
      </Field>
      <Field label="Confirmation (verify identity)">
        <textarea value={cs.confirmation ?? ''} onChange={(e) => upd({ confirmation: e.target.value })} rows={2} style={fieldStyle()} />
      </Field>
      <Field label="Reason for call">
        <textarea value={cs.reason ?? ''} onChange={(e) => upd({ reason: e.target.value })} rows={2} style={fieldStyle()} />
      </Field>
      <Field label="Qualifying questions (one per line)">
        <textarea
          value={qa.join('\n')}
          onChange={(e) => upd({ qualifying: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
          rows={5}
          style={fieldStyle()}
        />
      </Field>
      <Field label="Pitch">
        <textarea value={cs.pitch ?? ''} onChange={(e) => upd({ pitch: e.target.value })} rows={3} style={fieldStyle()} />
      </Field>
      <Field label="Close (the ask for the appointment)">
        <textarea value={cs.close ?? ''} onChange={(e) => upd({ close: e.target.value })} rows={3} style={fieldStyle()} />
      </Field>
      <Field label="Compliance disclaimer">
        <textarea value={cs.compliance ?? ''} onChange={(e) => upd({ compliance: e.target.value })} rows={2} style={fieldStyle()} />
      </Field>
      <Field label="Escalation rules (when to hand off to a human)">
        <textarea value={cs.escalation_rules ?? ''} onChange={(e) => upd({ escalation_rules: e.target.value })} rows={2} style={fieldStyle()} />
      </Field>
    </div>
  )
}

function SmsTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const sms = item.sms_scripts ?? {}
  const upd = (patch: Partial<typeof sms>) => set('sms_scripts', { ...sms, ...patch })
  const fields: Array<[keyof typeof sms, string]> = [
    ['first', 'Initial outreach'],
    ['second', 'Follow-up #2'],
    ['followup', 'Long-tail follow-up'],
    ['confirm', 'Confirmation (after booking)'],
    ['missed', 'Missed appointment'],
    ['reschedule', 'Reschedule offer'],
    ['no_response', 'No response after multiple touches'],
    ['stop_text', 'STOP / opt-out reply'],
  ]
  return (
    <div style={col()}>
      {fields.map(([key, label]) => (
        <Field key={key} label={label}>
          <textarea
            value={(sms[key] as string | undefined) ?? ''}
            onChange={(e) => upd({ [key]: e.target.value } as Partial<typeof sms>)}
            rows={2}
            style={fieldStyle()}
          />
        </Field>
      ))}
    </div>
  )
}

function EmailTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const em = item.email_templates ?? {}
  const upd = (patch: Partial<typeof em>) => set('email_templates', { ...em, ...patch })
  const fields: Array<[keyof typeof em, string]> = [
    ['initial', 'Initial email'],
    ['followup', 'Follow-up'],
    ['confirmation', 'Booking confirmation'],
    ['missed', 'Missed appointment'],
    ['reschedule', 'Reschedule'],
    ['longterm', 'Long-term nurture'],
  ]
  return (
    <div style={col()}>
      {fields.map(([key, label]) => (
        <Field key={key} label={label}>
          <textarea
            value={(em[key] as string | undefined) ?? ''}
            onChange={(e) => upd({ [key]: e.target.value } as Partial<typeof em>)}
            rows={4}
            style={fieldStyle()}
          />
        </Field>
      ))}
    </div>
  )
}

function ObjectionsTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const list: AiSalespersonObjection[] = item.objection_responses ?? []
  const updateAt = (i: number, patch: Partial<AiSalespersonObjection>) => {
    const next = list.map((o, idx) => (idx === i ? { ...o, ...patch } : o))
    set('objection_responses', next)
  }
  const remove = (i: number) => set('objection_responses', list.filter((_, idx) => idx !== i))
  const add = () => set('objection_responses', [...list, { trigger: '', response: '' }])
  return (
    <div style={col()}>
      {list.length === 0 && (
        <p style={{ color: '#6b7280', fontSize: 13 }}>No objections yet. Add patterns the AI should listen for and how to respond.</p>
      )}
      {list.map((o, i) => (
        <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, display: 'flex', gap: 8, flexDirection: 'column' }}>
          <input
            value={o.trigger}
            onChange={(e) => updateAt(i, { trigger: e.target.value })}
            placeholder="Trigger phrase (e.g. 'too expensive', 'not interested')"
            style={fieldStyle()}
          />
          <textarea
            value={o.response}
            onChange={(e) => updateAt(i, { response: e.target.value })}
            placeholder="How the AI should respond"
            rows={2}
            style={fieldStyle()}
          />
          <button onClick={() => remove(i)} style={ghostBtn()}>Remove</button>
        </div>
      ))}
      <button onClick={add} style={primaryBtn()}>+ Add objection</button>
    </div>
  )
}

function ScheduleTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const s = item.schedule ?? {}
  const upd = (patch: Partial<typeof s>) => set('schedule', { ...s, ...patch })
  const days = s.active_days ?? [1, 2, 3, 4, 5]
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort()
    upd({ active_days: next })
  }
  return (
    <div style={col()}>
      <Field label="Active days">
        <div style={{ display: 'flex', gap: 6 }}>
          {DAY_LABELS.map((label, i) => {
            const on = days.includes(i)
            return (
              <button key={i} onClick={() => toggleDay(i)} style={{
                background: on ? 'var(--red, #ff2800)' : '#fff',
                color: on ? '#fff' : '#111',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}>
                {label}
              </button>
            )
          })}
        </div>
      </Field>
      <Field label="Calling hours">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number"
            min={0}
            max={23}
            value={s.start_hour ?? 9}
            onChange={(e) => upd({ start_hour: Number(e.target.value) })}
            style={fieldStyle({ width: 80 })}
          />
          <span>to</span>
          <input
            type="number"
            min={0}
            max={23}
            value={s.end_hour ?? 17}
            onChange={(e) => upd({ end_hour: Number(e.target.value) })}
            style={fieldStyle({ width: 80 })}
          />
          <span style={{ color: '#6b7280', fontSize: 13 }}>(24h, lead local time)</span>
        </div>
      </Field>
      <Field label="Timezone">
        <input value={s.timezone ?? 'America/New_York'} onChange={(e) => upd({ timezone: e.target.value })} style={fieldStyle({ width: 260 })} />
      </Field>
      <Field label="Leads per hour">
        <input type="number" value={s.leads_per_hour ?? 18} onChange={(e) => upd({ leads_per_hour: Number(e.target.value) })} style={fieldStyle({ width: 120 })} />
      </Field>
      <Field label="Leads per day cap">
        <input type="number" value={s.leads_per_day ?? 120} onChange={(e) => upd({ leads_per_day: Number(e.target.value) })} style={fieldStyle({ width: 120 })} />
      </Field>
      <Field label="Max attempts per lead">
        <input type="number" value={s.max_attempts_per_lead ?? 4} onChange={(e) => upd({ max_attempts_per_lead: Number(e.target.value) })} style={fieldStyle({ width: 120 })} />
      </Field>
      <Field label="Retry delay between attempts (minutes)">
        <input type="number" value={s.retry_delay_min ?? 60} onChange={(e) => upd({ retry_delay_min: Number(e.target.value) })} style={fieldStyle({ width: 120 })} />
      </Field>
      <Field label="Quiet hours (e.g. 21:00-08:00)">
        <input value={s.quiet_hours ?? ''} onChange={(e) => upd({ quiet_hours: e.target.value })} style={fieldStyle({ width: 220 })} />
      </Field>
    </div>
  )
}

function CalendarTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const c = item.calendar ?? {}
  const upd = (patch: Partial<typeof c>) => set('calendar', { ...c, ...patch })
  return (
    <div style={col()}>
      <Field label="Provider">
        <select value={c.provider ?? 'ghl'} onChange={(e) => upd({ provider: e.target.value as typeof c.provider })} style={fieldStyle({ width: 200 })}>
          <option value="ghl">GoHighLevel</option>
          <option value="google">Google Calendar</option>
          <option value="cal">Cal.com</option>
          <option value="manual">Manual / none</option>
        </select>
      </Field>
      <Field label="Calendar ID">
        <input value={c.calendar_id ?? ''} onChange={(e) => upd({ calendar_id: e.target.value })} style={fieldStyle()} />
      </Field>
      <Field label="Public booking URL (optional)">
        <input value={c.calendar_url ?? ''} onChange={(e) => upd({ calendar_url: e.target.value })} style={fieldStyle()} />
      </Field>
      <Field label="Buffer between appointments (minutes)">
        <input type="number" value={c.buffer_min ?? 15} onChange={(e) => upd({ buffer_min: Number(e.target.value) })} style={fieldStyle({ width: 120 })} />
      </Field>
      <Field label="Max appointments per day">
        <input type="number" value={c.max_appts_per_day ?? 10} onChange={(e) => upd({ max_appts_per_day: Number(e.target.value) })} style={fieldStyle({ width: 120 })} />
      </Field>
      <Field label="Confirmations + reminders">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Toggle on={!!c.confirmation_sms} onClick={() => upd({ confirmation_sms: !c.confirmation_sms })} label="Confirmation SMS" />
          <Toggle on={!!c.confirmation_email} onClick={() => upd({ confirmation_email: !c.confirmation_email })} label="Confirmation email" />
          <Toggle on={!!c.reminder_sms} onClick={() => upd({ reminder_sms: !c.reminder_sms })} label="Reminder SMS" />
          <Toggle on={!!c.reminder_email} onClick={() => upd({ reminder_email: !c.reminder_email })} label="Reminder email" />
        </div>
      </Field>
    </div>
  )
}

function LeadRulesTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const pi = item.product_intent ?? {}
  const upd = (patch: Partial<typeof pi>) => set('product_intent', { ...pi, ...patch })
  return (
    <div style={col()}>
      <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
        Compliance + dedup rules. The system automatically prevents the same phone number from being claimed by two different AI Salespeople under your account.
      </p>
      <Field label="Compliance notes (recorded on every call)">
        <textarea value={pi.compliance_notes ?? ''} onChange={(e) => upd({ compliance_notes: e.target.value })} rows={3} style={fieldStyle()} />
      </Field>
      <Field label="Source of opt-in (e.g. landing page, lead form)">
        <input value={pi.opt_in_reason ?? ''} onChange={(e) => upd({ opt_in_reason: e.target.value })} style={fieldStyle()} />
      </Field>
    </div>
  )
}

function IntegrationsTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const cp = item.crm_push ?? {}
  const upd = (patch: Partial<typeof cp>) => set('crm_push', { ...cp, ...patch })
  const cal = item.calendar ?? {}
  const calendarConnected = !!cal.calendar_id

  // Locked decision #1: GHL push status indicator.
  const pushSummary = (() => {
    if (!calendarConnected) {
      return { ok: false, text: 'Connect a GHL calendar (in the Calendar tab) to enable CRM push.' }
    }
    if (cp.target_pipeline_name && cp.target_stage_name) {
      return {
        ok: true,
        text: `Pushing to GHL → "${cp.target_stage_name}" in "${cp.target_pipeline_name}"`,
      }
    }
    return {
      ok: true,
      text: 'GHL calendar connected. Appointments will be pushed to GHL automatically. Pipeline + stage routing will be auto-resolved on first booking.',
    }
  })()

  return (
    <div style={col()}>
      <div style={{
        background: pushSummary.ok ? '#dcfce7' : '#fef3c7',
        border: `1px solid ${pushSummary.ok ? '#86efac' : '#fcd34d'}`,
        color: pushSummary.ok ? '#15803d' : '#92400e',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 14,
        fontWeight: 600,
      }}>
        {pushSummary.text}
      </div>

      <Field label="CRM provider">
        <select value={cp.provider ?? 'ghl'} onChange={(e) => upd({ provider: e.target.value as typeof cp.provider })} style={fieldStyle({ width: 240 })}>
          <option value="ghl">GoHighLevel (default)</option>
          <option value="hubspot">HubSpot</option>
          <option value="pipedrive">Pipedrive</option>
          <option value="salesforce">Salesforce</option>
          <option value="custom_webhook">Custom webhook</option>
        </select>
      </Field>
      <Field label="Target pipeline (auto-resolved unless overridden)">
        <input
          value={cp.target_pipeline_name ?? ''}
          onChange={(e) => upd({ target_pipeline_name: e.target.value || null })}
          placeholder="Pipeline name in CRM"
          style={fieldStyle()}
        />
      </Field>
      <Field label="Target stage (default: 'Appointment Set')">
        <input
          value={cp.target_stage_name ?? ''}
          onChange={(e) => upd({ target_stage_name: e.target.value || null })}
          placeholder="Stage name in CRM"
          style={fieldStyle()}
        />
      </Field>
      <Field label="Assigned user in CRM (optional)">
        <input
          value={cp.assigned_user ?? ''}
          onChange={(e) => upd({ assigned_user: e.target.value || null })}
          style={fieldStyle()}
        />
      </Field>
      {cp.provider === 'custom_webhook' && (
        <Field label="Custom webhook URL">
          <input
            value={cp.webhook_url ?? ''}
            onChange={(e) => upd({ webhook_url: e.target.value || null })}
            placeholder="https://…"
            style={fieldStyle()}
          />
        </Field>
      )}
    </div>
  )
}

function AnalyticsTab({ item }: { item: AiSalesperson }) {
  return (
    <div style={col()}>
      <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
        Analytics for <strong>{item.name}</strong> are rolling up via the standard dialer analytics page. Per-AI-Salesperson reports land here in the next release.
      </p>
    </div>
  )
}

// ────────────────────────────── Reusable bits ──────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{label}</span>
      {children}
    </label>
  )
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} type="button" style={{
      background: on ? '#dcfce7' : '#f3f4f6',
      color: on ? '#15803d' : '#6b7280',
      border: `1px solid ${on ? '#86efac' : '#e5e7eb'}`,
      borderRadius: 999,
      padding: '4px 10px',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer',
    }}>
      {on ? '✓ ' : ''}{label}
    </button>
  )
}

function col(): React.CSSProperties {
  return { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760 }
}

function h3(): React.CSSProperties {
  return { margin: '8px 0 0', fontSize: 14, fontWeight: 700, color: '#111', borderBottom: '1px solid #f1f5f9', paddingBottom: 4 }
}

function fieldStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 14,
    fontFamily: 'inherit',
    ...(extra ?? {}),
  }
}

function primaryBtn(): React.CSSProperties {
  return {
    background: 'var(--red, #ff2800)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  }
}

function ghostBtn(): React.CSSProperties {
  return {
    background: 'transparent',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  }
}
