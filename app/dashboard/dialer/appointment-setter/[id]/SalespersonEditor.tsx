'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import type {
  AiSalesperson,
  AiSalespersonFollowup,
  AiSalespersonLeadConflict,
  AiSalespersonObjection,
} from '@/types'

// ─── Tab definitions ─────────────────────────────────────────────────────────

type WorkTab = 'dashboard' | 'leads' | 'followups' | 'calls' | 'pipeline'
type ConfigTab = 'settings' | 'persona' | 'call_script' | 'sms' | 'email' | 'objections' | 'schedule' | 'calendar' | 'lead_rules' | 'integrations'
type Tab = WorkTab | ConfigTab

const WORK_TABS: Array<{ id: WorkTab; label: string }> = [
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'leads',      label: 'Leads' },
  { id: 'followups',  label: 'Followups' },
  { id: 'calls',      label: 'Calls' },
  { id: 'pipeline',   label: 'Pipeline' },
]

const CONFIG_TABS: Array<{ id: ConfigTab; label: string }> = [
  { id: 'settings',     label: 'Settings' },
  { id: 'persona',      label: 'Persona' },
  { id: 'call_script',  label: 'Script' },
  { id: 'sms',          label: 'SMS' },
  { id: 'email',        label: 'Email' },
  { id: 'objections',   label: 'Objections' },
  { id: 'schedule',     label: 'Schedule' },
  { id: 'calendar',     label: 'Calendar' },
  { id: 'lead_rules',   label: 'Lead Rules' },
  { id: 'integrations', label: 'Integrations' },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Main editor ─────────────────────────────────────────────────────────────

export default function SalespersonEditor({ initial }: { initial: AiSalesperson }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('dashboard')
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
      {/* Sticky top bar: name + status + save */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        background: '#fff',
        border: '1px solid var(--border-soft)',
        borderRadius: 12,
        padding: '10px 14px',
        marginBottom: 10,
        position: 'sticky',
        top: 0,
        zIndex: 10,
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
            {saving ? 'Saving\u2026' : 'Save'}
          </button>
        </div>
      </div>

      {/* Two-row pill nav */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 44 }}>Work</span>
          {WORK_TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={pillStyle(tab === t.id)}>{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderTop: '1px solid var(--border-soft)', paddingTop: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 44 }}>Config</span>
          {CONFIG_TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={pillStyle(tab === t.id, true)}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ background: '#fff', border: '1px solid var(--border-soft)', borderRadius: 12, padding: 16 }}>
        {tab === 'dashboard'    && <DashboardTab item={item} />}
        {tab === 'leads'        && <LeadsTab item={item} />}
        {tab === 'followups'    && <FollowupsTab item={item} />}
        {tab === 'calls'        && <CallsTab item={item} />}
        {tab === 'pipeline'     && <PipelineTab item={item} />}
        {tab === 'settings'     && <SettingsTab item={item} set={set} />}
        {tab === 'persona'      && <PersonaTab item={item} set={set} />}
        {tab === 'call_script'  && <CallScriptTab item={item} set={set} />}
        {tab === 'sms'          && <SmsTab item={item} set={set} />}
        {tab === 'email'        && <EmailTab item={item} set={set} />}
        {tab === 'objections'   && <ObjectionsTab item={item} set={set} />}
        {tab === 'schedule'     && <ScheduleTab item={item} set={set} />}
        {tab === 'calendar'     && <CalendarTab item={item} set={set} />}
        {tab === 'lead_rules'   && <LeadRulesTab item={item} set={set} />}
        {tab === 'integrations' && <IntegrationsTab item={item} set={set} />}
      </div>
    </section>
  )
}

// ─── Dashboard tab ────────────────────────────────────────────────────────────

type DashboardStats = {
  today_dials: number
  today_appts: number
  pending_followups: number
  overdue_followups: number
  leads_in_queue: number
  leads_total: number
}
type RecentCall = {
  id: string
  to_number: string
  outcome: string | null
  duration_seconds: number | null
  started_at: string
  summary: string | null
  status: string
}
type OverdueFollowup = {
  id: string
  due_at: string
  channel: string
  reason: string | null
  status: string
}

function DashboardTab({ item }: { item: AiSalesperson }) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([])
  const [overdueItems, setOverdueItems] = useState<OverdueFollowup[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [expandedCall, setExpandedCall] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/me/ai-salespeople/${item.id}/dashboard`)
      const j = (await res.json()) as {
        ok?: boolean
        stats?: DashboardStats
        recent_calls?: RecentCall[]
        overdue_followups_items?: OverdueFollowup[]
        error?: string
      }
      if (!res.ok || !j.ok) { setErr(j.error ?? 'Load failed'); return }
      setStats(j.stats ?? null)
      setRecentCalls(j.recent_calls ?? [])
      setOverdueItems(j.overdue_followups_items ?? [])
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [item.id])

  return (
    <div style={col()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={h3()}>Book of business</h3>
        <button type="button" onClick={() => void load()} style={ghostBtn()} disabled={loading}>
          {loading ? 'Loading\u2026' : '\u21bb Refresh'}
        </button>
      </div>

      {err && <ErrBox text={err} />}

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          <KpiCard label="Dials today" value={stats.today_dials} />
          <KpiCard label="Appts today" value={stats.today_appts} accent />
          <KpiCard label="In queue" value={stats.leads_in_queue} />
          <KpiCard label="Total leads" value={stats.leads_total} />
          <KpiCard label="Pending callbacks" value={stats.pending_followups} warn={stats.overdue_followups > 0} />
          <KpiCard label="Overdue" value={stats.overdue_followups} warn={stats.overdue_followups > 0} />
        </div>
      )}

      {overdueItems.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e', marginBottom: 6 }}>
            \u26a0 {overdueItems.length} overdue callback{overdueItems.length > 1 ? 's' : ''} need attention
          </div>
          {overdueItems.map((f) => (
            <div key={f.id} style={{ fontSize: 12, color: '#78350f' }}>
              <strong>{f.channel.toUpperCase()}</strong> · Due {new Date(f.due_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              {f.reason ? ` — ${f.reason}` : ''}
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 style={{ ...h3(), marginBottom: 8 }}>Recent calls</h3>
        {recentCalls.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>No calls yet.</p>
        ) : (
          <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>
                  <th style={cellHead()}>Phone</th>
                  <th style={cellHead()}>Outcome</th>
                  <th style={cellHead()}>Duration</th>
                  <th style={cellHead()}>When</th>
                  <th style={cellHead()}>Summary</th>
                </tr>
              </thead>
              <tbody>
                {recentCalls.map((c) => (
                  <>
                    <tr
                      key={c.id}
                      style={{ borderTop: '1px solid var(--border-soft)', cursor: c.summary ? 'pointer' : 'default' }}
                      onClick={() => c.summary && setExpandedCall(expandedCall === c.id ? null : c.id)}
                    >
                      <td style={cellBody()}>{c.to_number}</td>
                      <td style={cellBody()}><OutcomeBadge outcome={c.outcome} /></td>
                      <td style={cellBody()}>{c.duration_seconds != null ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s` : '—'}</td>
                      <td style={cellBody()}>{new Date(c.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                      <td style={cellBody()}>{c.summary ? <span style={{ color: 'var(--red, #ff2800)', fontWeight: 600 }}>\u25be view</span> : '—'}</td>
                    </tr>
                    {expandedCall === c.id && c.summary && (
                      <tr key={`${c.id}-summary`} style={{ background: '#f8fafc' }}>
                        <td colSpan={5} style={{ padding: '8px 10px', fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{c.summary}</td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, value, accent, warn }: { label: string; value: number; accent?: boolean; warn?: boolean }) {
  const color = warn && value > 0 ? '#92400e' : accent && value > 0 ? '#15803d' : '#0f172a'
  const bg = warn && value > 0 ? '#fef3c7' : accent && value > 0 ? '#dcfce7' : '#fff'
  return (
    <div style={{ background: bg, border: '1px solid var(--border-soft)', borderRadius: 12, padding: '16px 18px', textAlign: 'left', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ fontSize: 36, fontWeight: 700, color, lineHeight: 1.05, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4, fontWeight: 400 }}>{label}</div>
    </div>
  )
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span style={{ color: '#9ca3af' }}>—</span>
  const map: Record<string, { color: string; bg: string }> = {
    confirmed: { color: '#15803d', bg: '#dcfce7' },
    booked:    { color: '#15803d', bg: '#dcfce7' },
    reschedule_requested: { color: '#92400e', bg: '#fef3c7' },
    cancelled:  { color: '#991b1b', bg: '#fee2e2' },
    no_answer:  { color: '#6b7280', bg: '#f3f4f6' },
    voicemail:  { color: '#6b7280', bg: '#f3f4f6' },
    connected:  { color: '#1d4ed8', bg: '#dbeafe' },
    positive:   { color: '#15803d', bg: '#dcfce7' },
    negative:   { color: '#991b1b', bg: '#fee2e2' },
    neutral:    { color: '#374151', bg: '#f3f4f6' },
  }
  const s = map[outcome] ?? { color: '#374151', bg: '#f3f4f6' }
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 999, padding: '2px 8px', fontWeight: 700, fontSize: 11 }}>
      {outcome.replace(/_/g, ' ')}
    </span>
  )
}

// ─── Calls tab ────────────────────────────────────────────────────────────────

function CallsTab({ item }: { item: AiSalesperson }) {
  const [calls, setCalls] = useState<RecentCall[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const LIMIT = 50

  async function load(off: number) {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/me/ai-salespeople/${item.id}/calls?limit=${LIMIT}&offset=${off}`)
      const j = (await res.json()) as { ok?: boolean; calls?: RecentCall[]; total?: number; error?: string }
      if (!res.ok || !j.ok) { setErr(j.error ?? 'Load failed'); return }
      setCalls(j.calls ?? [])
      setTotal(j.total ?? 0)
      setOffset(off)
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(0) }, [item.id])

  return (
    <div style={col()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={h3()}>Call history</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {total > 0 && <span style={{ fontSize: 12, color: '#6b7280' }}>{total} total</span>}
          <button type="button" onClick={() => void load(offset)} disabled={loading} style={ghostBtn()}>
            {loading ? 'Loading\u2026' : '\u21bb Refresh'}
          </button>
        </div>
      </div>
      {err && <ErrBox text={err} />}
      {calls.length === 0 && !loading ? (
        <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>No calls recorded yet.</p>
      ) : (
        <>
          <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>
                  <th style={cellHead()}>Phone</th>
                  <th style={cellHead()}>Outcome</th>
                  <th style={cellHead()}>Status</th>
                  <th style={cellHead()}>Duration</th>
                  <th style={cellHead()}>Date</th>
                  <th style={cellHead()}>Summary</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <>
                    <tr
                      key={c.id}
                      style={{ borderTop: '1px solid var(--border-soft)', cursor: c.summary ? 'pointer' : 'default' }}
                      onClick={() => c.summary && setExpanded(expanded === c.id ? null : c.id)}
                    >
                      <td style={cellBody()}>{c.to_number}</td>
                      <td style={cellBody()}><OutcomeBadge outcome={c.outcome} /></td>
                      <td style={cellBody()}>{c.status}</td>
                      <td style={cellBody()}>{c.duration_seconds != null ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s` : '—'}</td>
                      <td style={cellBody()}>{new Date(c.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                      <td style={cellBody()}>{c.summary ? <span style={{ color: 'var(--red, #ff2800)', fontWeight: 600 }}>\u25be view</span> : '—'}</td>
                    </tr>
                    {expanded === c.id && c.summary && (
                      <tr key={`${c.id}-exp`} style={{ background: '#f8fafc' }}>
                        <td colSpan={6} style={{ padding: '8px 10px', fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{c.summary}</td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          {total > LIMIT && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => void load(Math.max(0, offset - LIMIT))} disabled={offset === 0 || loading} style={ghostBtn()}>\u2190 Prev</button>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{offset + 1}\u2013{Math.min(offset + LIMIT, total)} of {total}</span>
              <button type="button" onClick={() => void load(offset + LIMIT)} disabled={offset + LIMIT >= total || loading} style={ghostBtn()}>Next \u2192</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Pipeline tab ─────────────────────────────────────────────────────────────

type QueueRow = {
  id: string
  phone: string
  status: string
  last_outcome: string | null
  attempt_count: number
  updated_at: string
}

const STAGE_ORDER = [
  'New Lead', 'Contacted', 'Engaged', 'Qualified', 'Appointment Set',
  'Follow-Up Scheduled', 'No Show', 'Needs Human Review', 'Disqualified', 'Opted Out', 'Closed Won',
]

const OUTCOME_TO_STAGE: Record<string, string> = {
  confirmed: 'Appointment Set',
  booked: 'Appointment Set',
  reschedule_requested: 'Follow-Up Scheduled',
  connected: 'Engaged',
  positive: 'Engaged',
  neutral: 'Contacted',
  cancelled: 'Disqualified',
  negative: 'Disqualified',
  no_answer: 'Contacted',
  voicemail: 'Contacted',
  provider_call_started: 'Contacted',
}

const STAGE_COLORS: Record<string, { bg: string; color: string }> = {
  'New Lead':            { bg: '#dbeafe', color: '#1e40af' },
  'Contacted':           { bg: '#e0e7ff', color: '#3730a3' },
  'Engaged':             { bg: '#d1fae5', color: '#065f46' },
  'Qualified':           { bg: '#a7f3d0', color: '#065f46' },
  'Appointment Set':     { bg: '#dcfce7', color: '#15803d' },
  'Follow-Up Scheduled': { bg: '#fef3c7', color: '#92400e' },
  'No Show':             { bg: '#fee2e2', color: '#991b1b' },
  'Needs Human Review':  { bg: '#fde68a', color: '#78350f' },
  'Disqualified':        { bg: '#f3f4f6', color: '#6b7280' },
  'Opted Out':           { bg: '#f3f4f6', color: '#9ca3af' },
  'Closed Won':          { bg: '#d1fae5', color: '#14532d' },
}

function StageChip({ stage }: { stage: string }) {
  const s = STAGE_COLORS[stage] ?? { bg: '#f3f4f6', color: '#374151' }
  return <span style={{ background: s.bg, color: s.color, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{stage}</span>
}

function PipelineTab({ item }: { item: AiSalesperson }) {
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/me/ai-salespeople/${item.id}/dashboard`)
      const j = (await res.json()) as { ok?: boolean; queue?: QueueRow[]; error?: string }
      if (!res.ok || !j.ok) { setErr(j.error ?? 'Load failed'); return }
      setQueue(j.queue ?? [])
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [item.id])

  const grouped: Record<string, QueueRow[]> = {}
  for (const row of queue) {
    const stage = OUTCOME_TO_STAGE[row.last_outcome ?? ''] ?? (row.last_outcome ? 'Other' : 'New Lead')
    ;(grouped[stage] = grouped[stage] ?? []).push(row)
  }
  const stages = [
    ...STAGE_ORDER.filter((s) => grouped[s]?.length),
    ...Object.keys(grouped).filter((s) => !STAGE_ORDER.includes(s) && grouped[s]?.length),
  ]

  return (
    <div style={col()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={h3()}>Pipeline by stage</h3>
        <button type="button" onClick={() => void load()} disabled={loading} style={ghostBtn()}>{loading ? 'Loading\u2026' : '\u21bb Refresh'}</button>
      </div>
      {err && <ErrBox text={err} />}
      {queue.length === 0 && !loading ? (
        <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>No leads in queue yet. Import leads in the Leads tab.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stages.map((stage) => {
            const rows = grouped[stage] ?? []
            return (
              <details key={stage} style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }} open={rows.length <= 15}>
                <summary style={{ background: '#f8fafc', padding: '10px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', userSelect: 'none' }}>
                  <StageChip stage={stage} />
                  <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 12 }}>{rows.length} lead{rows.length !== 1 ? 's' : ''}</span>
                </summary>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ background: '#f8fafc', borderTop: '1px solid var(--border-soft)' }}>
                      <tr>
                        <th style={cellHead()}>Phone</th>
                        <th style={cellHead()}>Attempts</th>
                        <th style={cellHead()}>Queue status</th>
                        <th style={cellHead()}>Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                          <td style={cellBody()}>{r.phone}</td>
                          <td style={cellBody()}>{r.attempt_count}</td>
                          <td style={cellBody()}>{r.status}</td>
                          <td style={cellBody()}>{new Date(r.updated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Followups tab ────────────────────────────────────────────────────────────

function FollowupsTab({ item }: { item: AiSalesperson }) {
  const [status, setStatus] = useState<AiSalespersonFollowup['status']>('pending')
  const [items, setItems] = useState<AiSalespersonFollowup[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/me/ai-salespeople/${item.id}/followups?status=${status}&limit=100`)
      const j = (await res.json()) as { ok?: boolean; items?: AiSalespersonFollowup[]; error?: string }
      if (!res.ok || !j.ok) { setErr(j.error ?? 'Failed to load'); return }
      setItems(j.items ?? [])
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [status, item.id])

  async function setFollowupStatus(followupId: string, nextStatus: AiSalespersonFollowup['status']) {
    setBusyId(followupId)
    setErr(null)
    try {
      const res = await fetch(`/api/me/ai-salespeople/${item.id}/followups`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followup_id: followupId, status: nextStatus }),
      })
      const j = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) { setErr(j.error ?? 'Failed to update'); return }
      setItems((prev) => prev.map((x) => (x.id === followupId ? { ...x, status: nextStatus } : x)))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={col()}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['pending', 'queued', 'done', 'cancelled'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} style={{ ...(status === s ? primaryBtn() : ghostBtn()), textTransform: 'capitalize' }}>{s}</button>
        ))}
        <button type="button" onClick={() => void load()} style={ghostBtn()}>{loading ? 'Loading\u2026' : '\u21bb Refresh'}</button>
      </div>
      {err && <ErrBox text={err} />}
      {loading ? (
        <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>Loading\u2026</p>
      ) : items.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>No {status} followups.</p>
      ) : (
        <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: '#f8fafc' }}>
              <tr>
                <th style={cellHead()}>Due</th>
                <th style={cellHead()}>Channel</th>
                <th style={cellHead()}>Reason</th>
                <th style={cellHead()}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => {
                const overdue = new Date(f.due_at) < new Date() && f.status === 'pending'
                return (
                  <tr key={f.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={{ ...cellBody(), color: overdue ? '#b91c1c' : undefined, fontWeight: overdue ? 700 : 400 }}>
                      {new Date(f.due_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {overdue ? ' \u26a0' : ''}
                    </td>
                    <td style={cellBody()}>{f.channel}</td>
                    <td style={cellBody()}>{f.reason || '—'}</td>
                    <td style={cellBody()}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {f.status !== 'done' && <button type="button" onClick={() => void setFollowupStatus(f.id, 'done')} disabled={busyId === f.id} style={ghostBtn()}>Done</button>}
                        {f.status !== 'cancelled' && <button type="button" onClick={() => void setFollowupStatus(f.id, 'cancelled')} disabled={busyId === f.id} style={ghostBtn()}>Cancel</button>}
                        {f.status !== 'pending' && <button type="button" onClick={() => void setFollowupStatus(f.id, 'pending')} disabled={busyId === f.id} style={ghostBtn()}>Re-open</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Leads tab ────────────────────────────────────────────────────────────────

type LeadCsvRow = {
  phone: string
  first_name?: string
  last_name?: string
  name?: string
  email?: string
  company?: string
  notes?: string
}

const IMPORT_CHUNK_SIZE = 500

function normalizeLeadRow(row: Record<string, string>): LeadCsvRow | null {
  const phone = row.phone ?? row.phone_number ?? row.mobile ?? row.cell ?? ''
  if (!phone) return null
  return {
    phone,
    first_name: row.first_name || undefined,
    last_name: row.last_name || undefined,
    name: row.name || row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || undefined,
    email: row.email || row.email_address || undefined,
    company: row.company || row.company_name || row.account || undefined,
    notes: row.notes || row.note || undefined,
  }
}

function parseLeadCsv(text: string): LeadCsvRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'))
  const out: LeadCsvRow[] = []
  for (const line of lines.slice(1)) {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = values[i] ?? '' })
    const lead = normalizeLeadRow(obj)
    if (lead) out.push(lead)
  }
  return out
}

function parseLeadXlsx(buf: ArrayBuffer): LeadCsvRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: LeadCsvRow[] = []
  for (const rawRow of raw) {
    const row: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawRow)) {
      row[k.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')] = String(v ?? '').trim()
    }
    const lead = normalizeLeadRow(row)
    if (lead) out.push(lead)
  }
  return out
}

type ExistingQueueRow = {
  id: string
  phone: string
  status: string
  last_outcome: string | null
  attempt_count: number
  updated_at: string
}

function LeadsTab({ item }: { item: AiSalesperson }) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [rows, setRows] = useState<LeadCsvRow[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [importErr, setImportErr] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<AiSalespersonLeadConflict[]>([])
  const [existing, setExisting] = useState<ExistingQueueRow[]>([])
  const [existingTotal, setExistingTotal] = useState(0)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const [optInConfirmed, setOptInConfirmed] = useState(false)
  const [caConfirmed, setCaConfirmed] = useState(false)

  const complianceOk = optInConfirmed && caConfirmed
  const canImport = rows.length > 0 && complianceOk && !busy

  async function loadExisting() {
    setLoadingExisting(true)
    try {
      const res = await fetch(`/api/me/ai-salespeople/${item.id}/dashboard`)
      const j = (await res.json()) as { ok?: boolean; queue?: ExistingQueueRow[]; stats?: { leads_total: number }; error?: string }
      if (res.ok && j.ok) {
        setExisting(j.queue ?? [])
        setExistingTotal(j.stats?.leads_total ?? 0)
      }
    } finally {
      setLoadingExisting(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadExisting() }, [item.id])

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const isXlsx = /\.(xlsx|xls)$/i.test(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      let parsed: LeadCsvRow[]
      if (isXlsx) {
        parsed = parseLeadXlsx(ev.target?.result as ArrayBuffer)
      } else {
        parsed = parseLeadCsv(String(ev.target?.result ?? ''))
      }
      setRows(parsed)
      setResult(null)
      setImportErr(parsed.length ? null : 'No valid rows found. File must include a phone column.')
      setConflicts([])
      setOptInConfirmed(false)
      setCaConfirmed(false)
    }
    if (isXlsx) {
      reader.readAsArrayBuffer(file)
    } else {
      reader.readAsText(file)
    }
    e.target.value = ''
  }

  async function importRows(confirmConflicts: boolean) {
    if (!rows.length || !complianceOk) return
    setBusy(true)
    setImportErr(null)
    setResult(null)
    setProgress(null)

    let totalInserted = 0
    let totalSkipped = 0
    let totalDropped = 0
    const chunks: LeadCsvRow[][] = []
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
      chunks.push(rows.slice(i, i + IMPORT_CHUNK_SIZE))
    }

    try {
      for (let ci = 0; ci < chunks.length; ci++) {
        setProgress({ done: ci, total: chunks.length })
        const res = await fetch('/api/me/appointment-setter-leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ai_salesperson_id: item.id,
            leads: chunks[ci],
            confirm_conflicts: confirmConflicts,
            compliance: { opt_in: true, california_ai_disclosure: true },
          }),
        })
        const j = (await res.json()) as {
          ok?: boolean; preview?: boolean; conflicts?: AiSalespersonLeadConflict[]
          inserted?: number; skipped?: number; dropped_conflicts?: number; error?: string
        }
        if (!res.ok || !j.ok) { setImportErr(j.error ?? 'Import failed'); return }
        if (j.preview && j.conflicts?.length) { setConflicts(j.conflicts); return }
        totalInserted += j.inserted ?? 0
        totalSkipped += j.skipped ?? 0
        totalDropped += j.dropped_conflicts ?? 0
      }

      setConflicts([])
      setRows([])
      setOptInConfirmed(false)
      setCaConfirmed(false)
      const summary = [
        `Imported ${totalInserted.toLocaleString()} leads.`,
        totalSkipped > 0 && `Skipped ${totalSkipped}.`,
        totalDropped > 0 && `Dropped ${totalDropped} conflicts.`,
      ].filter(Boolean).join(' ')
      setResult(summary)
      void loadExisting()
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div style={col()}>
      {/* Existing leads */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={h3()}>Leads in queue ({existingTotal})</h3>
        <button type="button" onClick={() => void loadExisting()} disabled={loadingExisting} style={ghostBtn()}>
          {loadingExisting ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>
      {existing.length === 0 && !loadingExisting ? (
        <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>No leads yet. Import a CSV or Excel file below.</p>
      ) : (
        <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: '#f8fafc' }}>
              <tr>
                <th style={cellHead()}>Phone</th>
                <th style={cellHead()}>Queue status</th>
                <th style={cellHead()}>Last outcome</th>
                <th style={cellHead()}>Attempts</th>
                <th style={cellHead()}>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {existing.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <td style={cellBody()}>{r.phone}</td>
                  <td style={cellBody()}>{r.status}</td>
                  <td style={cellBody()}><OutcomeBadge outcome={r.last_outcome} /></td>
                  <td style={cellBody()}>{r.attempt_count}</td>
                  <td style={cellBody()}>{new Date(r.updated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {existingTotal > existing.length && (
            <div style={{ padding: '8px 10px', fontSize: 12, color: '#64748b', borderTop: '1px solid var(--border-soft)' }}>
              Showing {existing.length} of {existingTotal} leads
            </div>
          )}
        </div>
      )}

      {/* Import */}
      <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
        <h3 style={{ ...h3(), marginBottom: 4 }}>Import leads</h3>
        <p style={{ color: '#475569', fontSize: 13, margin: '0 0 10px' }}>
          Accepts <strong>.csv</strong>, <strong>.xlsx</strong>, or <strong>.xls</strong>.
          Must include a <code>phone</code> column. Optional: first_name, last_name, name, email, company, notes.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" onClick={() => fileRef.current?.click()} style={primaryBtn()}>Choose file</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
          {rows.length > 0 && (
            <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
              {rows.length.toLocaleString()} leads parsed
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border-soft)', borderRadius: 8, marginBottom: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>
                  <th style={cellHead()}>#</th>
                  <th style={cellHead()}>Phone</th>
                  <th style={cellHead()}>Name</th>
                  <th style={cellHead()}>Email</th>
                  <th style={cellHead()}>Company</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={`${r.phone}-${i}`} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={cellBody()}>{i + 1}</td>
                    <td style={cellBody()}>{r.phone}</td>
                    <td style={cellBody()}>{(r.name ?? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()) || '—'}</td>
                    <td style={cellBody()}>{r.email ?? '—'}</td>
                    <td style={cellBody()}>{r.company ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 8 && (
              <div style={{ padding: '7px 10px', fontSize: 12, color: '#64748b', borderTop: '1px solid var(--border-soft)' }}>
                … and {(rows.length - 8).toLocaleString()} more rows
              </div>
            )}
          </div>
        )}

        {/* Compliance gates — shown after a file is loaded */}
        {rows.length > 0 && (
          <div style={{ background: '#fefce8', border: '1px solid #fcd34d', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#78350f', marginBottom: 10 }}>
              Required compliance acknowledgements — read before importing
            </div>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={optInConfirmed}
                onChange={(e) => setOptInConfirmed(e.target.checked)}
                style={{ marginTop: 2, accentColor: '#ca8a04', flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, color: '#44403c', lineHeight: 1.5 }}>
                <strong>I confirm all leads in this file have opted in</strong> to receive calls about this product or service.
                Calling non-opt-in leads may violate the TCPA and expose me to significant legal liability.
              </span>
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={caConfirmed}
                onChange={(e) => setCaConfirmed(e.target.checked)}
                style={{ marginTop: 2, accentColor: '#ca8a04', flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, color: '#44403c', lineHeight: 1.5 }}>
                <strong>If any leads are in California,</strong> my AI calling script includes a clear disclosure that this
                is an AI voice call, as required under California law (AB 2602 / SB 1228). This is my legal responsibility.
              </span>
            </label>
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void importRows(false)}
              disabled={!canImport}
              title={!complianceOk ? 'Check both compliance boxes above to unlock' : undefined}
              style={{ ...primaryBtn(), opacity: canImport ? 1 : 0.45, cursor: canImport ? 'pointer' : 'not-allowed' }}
            >
              {busy
                ? progress
                  ? `Importing batch ${progress.done + 1} / ${progress.total}…`
                  : 'Importing…'
                : `Import ${rows.length.toLocaleString()} lead${rows.length === 1 ? '' : 's'}`}
            </button>
            {!complianceOk && (
              <span style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>
                Check both boxes above to unlock import
              </span>
            )}
            {busy && progress && (
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {Math.round((progress.done / progress.total) * 100)}% complete
              </span>
            )}
          </div>
        )}

        {result && (
          <div style={{ background: '#dcfce7', color: '#166534', border: '1px solid #86efac', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginTop: 10 }}>
            {result}
          </div>
        )}
        {importErr && <ErrBox text={importErr} />}
      </div>

      {/* Conflict modal */}
      {conflicts.length > 0 && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.38)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ width: 'min(760px, 100%)', maxHeight: '82vh', overflow: 'auto', background: '#fff', borderRadius: 12, border: '1px solid var(--border-soft)', padding: 16 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>Lead conflict preview</h3>
            <p style={{ margin: '0 0 12px', color: '#64748b', fontSize: 13 }}>
              {conflicts.length} phone number{conflicts.length === 1 ? '' : 's'} already belong to another AI SDR.
            </p>
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ background: '#f8fafc' }}>
                  <tr><th style={cellHead()}>Phone</th><th style={cellHead()}>Owned by</th></tr>
                </thead>
                <tbody>
                  {conflicts.slice(0, 30).map((c) => (
                    <tr key={`${c.phone}-${c.existing_setter_id}`} style={{ borderTop: '1px solid var(--border-soft)' }}>
                      <td style={cellBody()}>{c.phone}</td>
                      <td style={cellBody()}>{c.existing_setter_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConflicts([])} style={ghostBtn()}>Cancel</button>
              <button type="button" onClick={() => void importRows(true)} disabled={busy} style={primaryBtn()}>
                {busy ? 'Importing…' : 'Skip conflicts and import rest'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Config tabs ──────────────────────────────────────────────────────────────

type SetFn = <K extends keyof AiSalesperson>(key: K, value: AiSalesperson[K]) => void

function SettingsTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const cs = item.call_script ?? {}
  const updCs = (patch: Partial<typeof cs>) => set('call_script', { ...cs, ...patch })
  const recordCalls = cs.record_calls ?? false
  return (
    <div style={col()}>
      <Field label="Product category">
        <input value={item.product_category ?? ''} onChange={(e) => set('product_category', e.target.value || null)} placeholder="e.g. Mortgage, Solar, B2B SaaS" style={fieldStyle()} />
      </Field>
      <Field label="Appointment type">
        <select value={item.appointment_type ?? 'phone'} onChange={(e) => set('appointment_type', e.target.value)} style={fieldStyle()}>
          <option value="phone">Phone call</option>
          <option value="video">Video call</option>
          <option value="in_person">In person</option>
        </select>
      </Field>
      <Field label="Appointment duration (minutes)">
        <input type="number" value={item.appointment_duration_min ?? 30} onChange={(e) => set('appointment_duration_min', Number(e.target.value) || 30)} style={fieldStyle({ width: 120 })} />
      </Field>
      <Field label="Outbound phone number override (optional)">
        <input value={item.phone_number ?? ''} onChange={(e) => set('phone_number', e.target.value || null)} placeholder="+15551234567 — leave blank to use rep number" style={fieldStyle()} />
      </Field>
      <Field label="Phone provider">
        <select value={item.phone_provider ?? ''} onChange={(e) => set('phone_provider', (e.target.value || null) as AiSalesperson['phone_provider'])} style={fieldStyle({ width: 200 })}>
          <option value="">— inherit from rep —</option>
          <option value="revring">AI Voice</option>
          <option value="twilio">Twilio</option>
        </select>
      </Field>

      {/* Call recording */}
      <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 16, marginTop: 4 }}>
        <Field label="Record calls">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle
              on={recordCalls}
              onClick={() => updCs({ record_calls: !recordCalls })}
              label={recordCalls ? 'Yes — calls will be recorded' : 'No'}
            />
          </div>
        </Field>
        {recordCalls && (
          <>
            <div style={{
              background: '#fffbeb', border: '1.5px solid #fcd34d', borderRadius: 8,
              padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#92400e', lineHeight: 1.5,
            }}>
              <strong>Required:</strong> Your script opener must include a recording disclosure before the AI proceeds.
              This line will be used as the disclosure — make sure it matches your state&apos;s consent laws
              (one-party vs. two-party recording states).
            </div>
            <Field label="Recording disclosure line">
              <textarea
                value={cs.recording_disclosure ?? 'This call may be recorded for quality and training purposes.'}
                onChange={(e) => updCs({ recording_disclosure: e.target.value })}
                rows={2}
                style={fieldStyle()}
              />
            </Field>
          </>
        )}
      </div>
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
      <Field label="AI name (what the lead hears)"><input value={p.ai_name ?? ''} onChange={(e) => upd({ ai_name: e.target.value })} style={fieldStyle()} /></Field>
      <Field label="Role title"><input value={p.role_title ?? ''} onChange={(e) => upd({ role_title: e.target.value })} placeholder="e.g. Senior Loan Specialist" style={fieldStyle()} /></Field>
      <Field label="Tone">
        <select value={p.tone ?? 'warm'} onChange={(e) => upd({ tone: e.target.value })} style={fieldStyle({ width: 220 })}>
          <option value="warm">Warm</option>
          <option value="professional">Professional</option>
          <option value="energetic">Energetic</option>
          <option value="consultative">Consultative</option>
          <option value="direct">Direct</option>
        </select>
      </Field>
      <Field label="Voice ID (provider-specific)"><input value={p.voice_id ?? ''} onChange={(e) => upd({ voice_id: e.target.value })} placeholder="Optional — overrides default voice" style={fieldStyle()} /></Field>
      <Field label="Opening line"><textarea value={p.opener ?? ''} onChange={(e) => upd({ opener: e.target.value })} rows={2} style={fieldStyle()} /></Field>
      <h3 style={h3()}>Product</h3>
      <Field label="Product name"><input value={pi.name ?? ''} onChange={(e) => updP({ name: e.target.value })} style={fieldStyle()} /></Field>
      <Field label="What it does (used in pitch)"><textarea value={pi.explanation ?? ''} onChange={(e) => updP({ explanation: e.target.value })} rows={3} style={fieldStyle()} /></Field>
      <Field label="Audience"><input value={pi.audience ?? ''} onChange={(e) => updP({ audience: e.target.value })} placeholder="Who is this for?" style={fieldStyle()} /></Field>
      <Field label="Why the lead opted in (compliance reason)"><input value={pi.opt_in_reason ?? ''} onChange={(e) => updP({ opt_in_reason: e.target.value })} style={fieldStyle()} /></Field>
      <Field label="Talking points"><textarea value={pi.talking_points ?? ''} onChange={(e) => updP({ talking_points: e.target.value })} rows={3} style={fieldStyle()} /></Field>
      <Field label="Things to avoid"><textarea value={pi.avoid ?? ''} onChange={(e) => updP({ avoid: e.target.value })} rows={2} style={fieldStyle()} /></Field>
    </div>
  )
}

function CallScriptTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const cs = item.call_script ?? {}
  const upd = (patch: Partial<typeof cs>) => set('call_script', { ...cs, ...patch })
  const qa = cs.qualifying ?? []
  return (
    <div style={col()}>
      {cs.record_calls && (
        <div style={{
          background: '#fef9c3', border: '1.5px solid #fde047', borderRadius: 8,
          padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 15, flexShrink: 0 }}>🔴</span>
          <p style={{ margin: 0, fontSize: 12, color: '#713f12', lineHeight: 1.5 }}>
            <strong>Call recording is ON.</strong> The following disclosure must appear in your opener:{' '}
            <em>&ldquo;{cs.recording_disclosure ?? 'This call may be recorded for quality and training purposes.'}&rdquo;</em>
            <br />Edit the disclosure in Settings → Record calls.
          </p>
        </div>
      )}
      <Field label="Opening"><textarea value={cs.opening ?? ''} onChange={(e) => upd({ opening: e.target.value })} rows={3} style={fieldStyle()} /></Field>
      <Field label="Confirmation (verify identity)"><textarea value={cs.confirmation ?? ''} onChange={(e) => upd({ confirmation: e.target.value })} rows={2} style={fieldStyle()} /></Field>
      <Field label="Reason for call"><textarea value={cs.reason ?? ''} onChange={(e) => upd({ reason: e.target.value })} rows={2} style={fieldStyle()} /></Field>
      <Field label="Qualifying questions (one per line)">
        <textarea value={qa.join('\n')} onChange={(e) => upd({ qualifying: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} rows={5} style={fieldStyle()} />
      </Field>
      <Field label="Pitch"><textarea value={cs.pitch ?? ''} onChange={(e) => upd({ pitch: e.target.value })} rows={3} style={fieldStyle()} /></Field>
      <Field label="Close (the ask for the appointment)"><textarea value={cs.close ?? ''} onChange={(e) => upd({ close: e.target.value })} rows={3} style={fieldStyle()} /></Field>
      <Field label="Compliance disclaimer"><textarea value={cs.compliance ?? ''} onChange={(e) => upd({ compliance: e.target.value })} rows={2} style={fieldStyle()} /></Field>
      <Field label="Escalation rules"><textarea value={cs.escalation_rules ?? ''} onChange={(e) => upd({ escalation_rules: e.target.value })} rows={2} style={fieldStyle()} /></Field>
    </div>
  )
}

function SmsTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const sms = item.sms_scripts ?? {}
  const upd = (patch: Partial<typeof sms>) => set('sms_scripts', { ...sms, ...patch })
  const fields: Array<[keyof typeof sms, string]> = [
    ['first', 'Initial outreach'], ['second', 'Follow-up #2'], ['followup', 'Long-tail follow-up'],
    ['confirm', 'Confirmation (after booking)'], ['missed', 'Missed appointment'],
    ['reschedule', 'Reschedule offer'], ['no_response', 'No response after multiple touches'], ['stop_text', 'STOP / opt-out reply'],
  ]
  return (
    <div style={col()}>
      {fields.map(([key, label]) => (
        <Field key={key} label={label}>
          <textarea value={(sms[key] as string | undefined) ?? ''} onChange={(e) => upd({ [key]: e.target.value } as Partial<typeof sms>)} rows={2} style={fieldStyle()} />
        </Field>
      ))}
    </div>
  )
}

function EmailTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const em = item.email_templates ?? {}
  const upd = (patch: Partial<typeof em>) => set('email_templates', { ...em, ...patch })
  const fields: Array<[keyof typeof em, string]> = [
    ['initial', 'Initial email'], ['followup', 'Follow-up'], ['confirmation', 'Booking confirmation'],
    ['missed', 'Missed appointment'], ['reschedule', 'Reschedule'], ['longterm', 'Long-term nurture'],
  ]
  return (
    <div style={col()}>
      {fields.map(([key, label]) => (
        <Field key={key} label={label}>
          <textarea value={(em[key] as string | undefined) ?? ''} onChange={(e) => upd({ [key]: e.target.value } as Partial<typeof em>)} rows={4} style={fieldStyle()} />
        </Field>
      ))}
    </div>
  )
}

function ObjectionsTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const list: AiSalespersonObjection[] = item.objection_responses ?? []
  const updateAt = (i: number, patch: Partial<AiSalespersonObjection>) =>
    set('objection_responses', list.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
  const remove = (i: number) => set('objection_responses', list.filter((_, idx) => idx !== i))
  const add = () => set('objection_responses', [...list, { trigger: '', response: '' }])
  return (
    <div style={col()}>
      {list.length === 0 && <p style={{ color: '#6b7280', fontSize: 13 }}>No objections yet.</p>}
      {list.map((o, i) => (
        <div key={i} style={{ border: '1px solid var(--border-soft)', borderRadius: 8, padding: 10, display: 'flex', gap: 8, flexDirection: 'column' }}>
          <input value={o.trigger} onChange={(e) => updateAt(i, { trigger: e.target.value })} placeholder="Trigger phrase (e.g. 'too expensive')" style={fieldStyle()} />
          <textarea value={o.response} onChange={(e) => updateAt(i, { response: e.target.value })} placeholder="How the AI should respond" rows={2} style={fieldStyle()} />
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
  const toggleDay = (d: number) => upd({ active_days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort() })
  return (
    <div style={col()}>
      <Field label="Active days">
        <div style={{ display: 'flex', gap: 6 }}>
          {DAY_LABELS.map((label, i) => {
            const on = days.includes(i)
            return <button key={i} onClick={() => toggleDay(i)} style={{ background: on ? 'var(--red, #ff2800)' : '#fff', color: on ? '#fff' : '#111', border: '1px solid var(--border-soft)', borderRadius: 6, padding: '6px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{label}</button>
          })}
        </div>
      </Field>
      <Field label="Calling hours">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" min={0} max={23} value={s.start_hour ?? 9} onChange={(e) => upd({ start_hour: Number(e.target.value) })} style={fieldStyle({ width: 80 })} />
          <span>to</span>
          <input type="number" min={0} max={23} value={s.end_hour ?? 17} onChange={(e) => upd({ end_hour: Number(e.target.value) })} style={fieldStyle({ width: 80 })} />
          <span style={{ color: '#6b7280', fontSize: 13 }}>(24h, lead local time)</span>
        </div>
      </Field>
      <Field label="Timezone"><input value={s.timezone ?? 'America/New_York'} onChange={(e) => upd({ timezone: e.target.value })} style={fieldStyle({ width: 260 })} /></Field>
      <Field label="Leads per hour"><input type="number" value={s.leads_per_hour ?? 18} onChange={(e) => upd({ leads_per_hour: Number(e.target.value) })} style={fieldStyle({ width: 120 })} /></Field>
      <Field label="Leads per day cap"><input type="number" value={s.leads_per_day ?? 120} onChange={(e) => upd({ leads_per_day: Number(e.target.value) })} style={fieldStyle({ width: 120 })} /></Field>
      <Field label="Max attempts per lead"><input type="number" value={s.max_attempts_per_lead ?? 4} onChange={(e) => upd({ max_attempts_per_lead: Number(e.target.value) })} style={fieldStyle({ width: 120 })} /></Field>
      <Field label="Retry delay between attempts (minutes)"><input type="number" value={s.retry_delay_min ?? 60} onChange={(e) => upd({ retry_delay_min: Number(e.target.value) })} style={fieldStyle({ width: 120 })} /></Field>
      <Field label="Quiet hours (e.g. 21:00-08:00)"><input value={s.quiet_hours ?? ''} onChange={(e) => upd({ quiet_hours: e.target.value })} style={fieldStyle({ width: 220 })} /></Field>
    </div>
  )
}

function CalendarTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const c = item.calendar ?? {}
  const upd = (patch: Partial<typeof c>) => set('calendar', { ...c, ...patch })
  const provider = c.provider ?? 'ghl'
  const missingCalendarId = provider !== 'manual' && !c.calendar_id
  return (
    <div style={col()}>
      {missingCalendarId && (
        <div style={{
          background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: 8,
          padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
          <p style={{ margin: 0, fontSize: 13, color: '#92400e', lineHeight: 1.5 }}>
            <strong>Calendar ID required for auto-booking.</strong> Without it, the AI will confirm appointments verbally on the call but they will NOT be written to the calendar.
            {provider === 'ghl' && <> Find it in GHL → Calendars → your calendar → Settings → Calendar ID.</>}
          </p>
        </div>
      )}
      <Field label="Provider">
        <select value={provider} onChange={(e) => upd({ provider: e.target.value as typeof c.provider })} style={fieldStyle({ width: 200 })}>
          <option value="ghl">GoHighLevel</option>
          <option value="google">Google Calendar</option>
          <option value="cal">Cal.com</option>
          <option value="manual">Manual / none</option>
        </select>
      </Field>
      <Field label="Calendar ID"><input value={c.calendar_id ?? ''} onChange={(e) => upd({ calendar_id: e.target.value })} style={fieldStyle()} /></Field>
      <Field label="Public booking URL (optional)"><input value={c.calendar_url ?? ''} onChange={(e) => upd({ calendar_url: e.target.value })} style={fieldStyle()} /></Field>
      <Field label="Buffer between appointments (minutes)"><input type="number" value={c.buffer_min ?? 15} onChange={(e) => upd({ buffer_min: Number(e.target.value) })} style={fieldStyle({ width: 120 })} /></Field>
      <Field label="Max appointments per day"><input type="number" value={c.max_appts_per_day ?? 10} onChange={(e) => upd({ max_appts_per_day: Number(e.target.value) })} style={fieldStyle({ width: 120 })} /></Field>
      <Field label="Confirmations + reminders">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Toggle on={!!c.confirmation_sms} onClick={() => upd({ confirmation_sms: !c.confirmation_sms })} label="Confirmation SMS" />
          <Toggle on={!!c.confirmation_email} onClick={() => upd({ confirmation_email: !c.confirmation_email })} label="Confirmation email" />
          <Toggle on={!!c.reminder_sms} onClick={() => upd({ reminder_sms: !c.reminder_sms })} label="Reminder SMS" />
          <Toggle on={!!c.reminder_email} onClick={() => upd({ reminder_email: !c.reminder_email })} label="Reminder email" />
        </div>
      </Field>

      {/* RevRing variable requirement */}
      <div style={{
        background: '#f0f9ff', border: '1.5px solid #bae6fd', borderRadius: 8,
        padding: '12px 14px', marginTop: 4,
      }}>
        <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: '#0c4a6e' }}>
          ⚙️ Required: configure booking_time in your RevRing assistant
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#0369a1', lineHeight: 1.55 }}>
          When the AI confirms an appointment, the RevRing assistant <strong>must output the agreed time
          as a call variable named <code>booking_time</code></strong> (ISO 8601, e.g.{' '}
          <code>2025-06-15T14:00:00-05:00</code>). Without it, the booking will be confirmed verbally
          but <strong>will not be written to the calendar</strong>.<br />
          Also set <code>booking_end_time</code> if you want a specific end time (otherwise defaults to
          30 min after start). In your RevRing agent config, map these under
          &quot;Variables → On confirmed outcome.&quot;
        </p>
      </div>
    </div>
  )
}

function LeadRulesTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const pi = item.product_intent ?? {}
  const upd = (patch: Partial<typeof pi>) => set('product_intent', { ...pi, ...patch })
  return (
    <div style={col()}>
      <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>Compliance + dedup rules. The system automatically prevents the same phone from being claimed by two AI SDRs.</p>
      <Field label="Compliance notes (recorded on every call)"><textarea value={pi.compliance_notes ?? ''} onChange={(e) => upd({ compliance_notes: e.target.value })} rows={3} style={fieldStyle()} /></Field>
      <Field label="Source of opt-in (e.g. landing page, lead form)"><input value={pi.opt_in_reason ?? ''} onChange={(e) => upd({ opt_in_reason: e.target.value })} style={fieldStyle()} /></Field>
    </div>
  )
}

function IntegrationsTab({ item, set }: { item: AiSalesperson; set: SetFn }) {
  const cp = item.crm_push ?? {}
  const upd = (patch: Partial<typeof cp>) => set('crm_push', { ...cp, ...patch })
  const calendarConnected = !!(item.calendar ?? {}).calendar_id
  const pushSummary = (() => {
    if (!calendarConnected) return { ok: false, text: 'Connect a GHL calendar (in the Calendar tab) to enable CRM push.' }
    if (cp.target_pipeline_name && cp.target_stage_name) return { ok: true, text: `Pushing to GHL \u2192 "${cp.target_stage_name}" in "${cp.target_pipeline_name}"` }
    return { ok: true, text: 'GHL calendar connected. Appointments will be pushed to GHL automatically.' }
  })()
  return (
    <div style={col()}>
      <div style={{ background: pushSummary.ok ? '#dcfce7' : '#fef3c7', border: `1px solid ${pushSummary.ok ? '#86efac' : '#fcd34d'}`, color: pushSummary.ok ? '#15803d' : '#92400e', borderRadius: 8, padding: '10px 14px', fontSize: 14, fontWeight: 600 }}>
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
      <Field label="Target pipeline"><input value={cp.target_pipeline_name ?? ''} onChange={(e) => upd({ target_pipeline_name: e.target.value || null })} placeholder="Pipeline name in CRM" style={fieldStyle()} /></Field>
      <Field label="Target stage (default: 'Appointment Set')"><input value={cp.target_stage_name ?? ''} onChange={(e) => upd({ target_stage_name: e.target.value || null })} placeholder="Stage name in CRM" style={fieldStyle()} /></Field>
      <Field label="Assigned user in CRM (optional)"><input value={cp.assigned_user ?? ''} onChange={(e) => upd({ assigned_user: e.target.value || null })} style={fieldStyle()} /></Field>
      {cp.provider === 'custom_webhook' && (
        <Field label="Custom webhook URL"><input value={cp.webhook_url ?? ''} onChange={(e) => upd({ webhook_url: e.target.value || null })} placeholder="https://\u2026" style={fieldStyle()} /></Field>
      )}
    </div>
  )
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function ErrBox({ text }: { text: string }) {
  return <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>{text}</div>
}

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
    <button onClick={onClick} type="button" style={{ background: on ? '#dcfce7' : '#f3f4f6', color: on ? '#15803d' : '#6b7280', border: `1px solid ${on ? '#86efac' : '#e5e7eb'}`, borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
      {on ? '\u2713 ' : ''}{label}
    </button>
  )
}

function pillStyle(active: boolean, muted = false): React.CSSProperties {
  return {
    background: active ? 'var(--red, #ff2800)' : muted ? '#f9fafb' : 'transparent',
    color: active ? '#fff' : muted ? '#6b7280' : '#374151',
    border: active ? 'none' : '1px solid #e5e7eb',
    borderRadius: 999,
    padding: '5px 13px',
    fontSize: active ? 13 : 12,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
  }
}

function col(): React.CSSProperties {
  return { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760 }
}

function h3(): React.CSSProperties {
  return { margin: '0 0 2px', fontSize: 14, fontWeight: 700, color: '#111', borderBottom: '1px solid var(--border-soft)', paddingBottom: 4 }
}

function fieldStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { width: '100%', border: '1px solid var(--border-soft)', borderRadius: 6, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', ...(extra ?? {}) }
}

function primaryBtn(): React.CSSProperties {
  return { background: 'var(--red, #ff2800)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' }
}

function ghostBtn(): React.CSSProperties {
  return { background: 'transparent', color: '#6b7280', border: '1px solid var(--border-soft)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', alignSelf: 'flex-start' }
}

function cellHead(): React.CSSProperties {
  return { textAlign: 'left', padding: '8px 10px', color: '#475569', fontWeight: 700, borderBottom: '1px solid var(--border-soft)' }
}

function cellBody(): React.CSSProperties {
  return { padding: '7px 10px', color: '#0f172a' }
}
