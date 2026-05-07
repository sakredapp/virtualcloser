'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CrmLead, Disposition, LeadNote, LeadEvent } from '@/types'
import {
  DISPOSITION_ORDER,
  DISPOSITION_LABEL,
  DISPOSITION_COLOR,
} from '@/lib/crmLeads'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: '2-digit',
    hour: 'numeric', minute: '2-digit',
  })
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return fmtDate(iso)
}

function DispositionPill({ d }: { d: Disposition | null }) {
  const key = d ?? 'new'
  const c = DISPOSITION_COLOR[key]
  return (
    <span
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
      className="px-2 py-0.5 rounded-full text-xs font-medium"
    >
      {DISPOSITION_LABEL[key]}
    </span>
  )
}

// ── types ─────────────────────────────────────────────────────────────────────

type Member = { id: string; display_name: string; email: string }

type CallLog = {
  id: string
  contact_name: string
  summary: string | null
  outcome: string | null
  next_step: string | null
  duration_minutes: number | null
  created_at: string
}

type Task = {
  id: string
  item_type: string
  content: string
  priority: string
  status: string
  due_date: string | null
  created_at: string
}

type Tab = 'all' | 'notes' | 'emails' | 'sms' | 'calls' | 'meetings' | 'tasks'

type Props = {
  lead: CrmLead
  initialNotes: LeadNote[]
  events: LeadEvent[]
  calls: CallLog[]
  tasks: Task[]
  members: Member[]
  currentMemberId: string
  repId: string
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ProspectDetail({
  lead: initialLead,
  initialNotes,
  events,
  calls,
  tasks,
  members,
  currentMemberId,
  repId,
}: Props) {
  const router = useRouter()
  const [lead, setLead] = useState(initialLead)
  const [notes, setNotes] = useState(initialNotes)
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [showLogCall, setShowLogCall] = useState(false)

  // Edit form state (mirrors CrmLead fields)
  const [editForm, setEditForm] = useState({
    name: lead.name,
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    company: lead.company ?? '',
    source: lead.source ?? '',
    product_intent: lead.product_intent ?? '',
    disposition: (lead.disposition ?? 'new') as Disposition,
    owner_member_id: lead.owner_member_id ?? '',
    notes: lead.notes ?? '',
    campaign_notes: lead.campaign_notes ?? '',
    next_followup_at: lead.next_followup_at ? lead.next_followup_at.slice(0, 16) : '',
    sms_consent: lead.sms_consent ?? false,
  })

  function memberName(id: string | null) {
    if (!id) return null
    return members.find(m => m.id === id)?.display_name ?? null
  }

  async function saveEdits() {
    setSaving(true)
    const payload: Record<string, unknown> = {
      name: editForm.name,
      email: editForm.email || null,
      phone: editForm.phone || null,
      company: editForm.company || null,
      source: editForm.source || null,
      product_intent: editForm.product_intent || null,
      owner_member_id: editForm.owner_member_id || null,
      notes: editForm.notes || null,
      campaign_notes: editForm.campaign_notes || null,
      next_followup_at: editForm.next_followup_at ? new Date(editForm.next_followup_at).toISOString() : null,
      sms_consent: editForm.sms_consent,
    }
    // Handle disposition separately (goes through setDisposition)
    if (editForm.disposition !== (lead.disposition ?? 'new')) {
      payload.disposition = editForm.disposition
    }
    await fetch(`/api/crm-leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setLead(prev => ({
      ...prev,
      ...payload,
      disposition: editForm.disposition,
    } as CrmLead))
    setEditing(false)
    setSaving(false)
  }

  async function changeDisposition(d: Disposition) {
    setLead(prev => ({ ...prev, disposition: d }))
    await fetch(`/api/crm-leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposition: d }),
    })
  }

  async function submitNote(e: React.FormEvent) {
    e.preventDefault()
    if (!noteText.trim()) return
    await fetch(`/api/crm-leads/${lead.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: noteText.trim() }),
    })
    const fresh = await fetch(`/api/crm-leads/${lead.id}/notes`).then(r => r.json())
    setNotes(fresh)
    setNoteText('')
    setAddingNote(false)
  }

  // Build activity feed
  type FeedItem =
    | { kind: 'note'; data: LeadNote }
    | { kind: 'event'; data: LeadEvent }
    | { kind: 'call'; data: CallLog }
    | { kind: 'task'; data: Task }

  const allFeed: FeedItem[] = [
    ...notes.map(n => ({ kind: 'note' as const, data: n })),
    ...events.map(e => ({ kind: 'event' as const, data: e })),
    ...calls.map(c => ({ kind: 'call' as const, data: c })),
    ...tasks.map(t => ({ kind: 'task' as const, data: t })),
  ].sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime())

  const filteredFeed = allFeed.filter(item => {
    if (activeTab === 'all') return true
    if (activeTab === 'notes') return item.kind === 'note'
    if (activeTab === 'calls') return item.kind === 'call'
    if (activeTab === 'tasks') return item.kind === 'task'
    return false
  })

  const dispColor = DISPOSITION_COLOR[lead.disposition ?? 'new']

  // ── Edit mode ────────────────────────────────────────────────────────────────

  if (editing) {
    return (
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setEditing(false)}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">Edit Prospect</h1>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
              <input
                required
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                value={editForm.email}
                onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input
                value={editForm.phone}
                onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Company</label>
              <input
                value={editForm.company}
                onChange={e => setEditForm(f => ({ ...f, company: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
              <input
                value={editForm.source}
                onChange={e => setEditForm(f => ({ ...f, source: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Product Intent</label>
              <input
                value={editForm.product_intent}
                onChange={e => setEditForm(f => ({ ...f, product_intent: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Disposition</label>
              <select
                value={editForm.disposition}
                onChange={e => setEditForm(f => ({ ...f, disposition: e.target.value as Disposition }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
              >
                {DISPOSITION_ORDER.map(d => (
                  <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Assigned To</label>
              <select
                value={editForm.owner_member_id}
                onChange={e => setEditForm(f => ({ ...f, owner_member_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
              >
                <option value="">Unassigned</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Next Follow-up</label>
              <input
                type="datetime-local"
                value={editForm.next_followup_at}
                onChange={e => setEditForm(f => ({ ...f, next_followup_at: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sms_consent"
                checked={editForm.sms_consent}
                onChange={e => setEditForm(f => ({ ...f, sms_consent: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="sms_consent" className="text-sm text-gray-700">SMS Consent</label>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea
                value={editForm.notes}
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10 resize-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Campaign Notes</label>
              <textarea
                value={editForm.campaign_notes}
                onChange={e => setEditForm(f => ({ ...f, campaign_notes: e.target.value }))}
                rows={2}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10 resize-none"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 border border-gray-200 rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={saveEdits}
              className="flex-1 bg-gray-900 text-white rounded-xl py-2 text-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Detail view ──────────────────────────────────────────────────────────────

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
        <Link href="/dashboard/prospects" className="hover:text-gray-600">Prospects</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{lead.name}</span>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">

        {/* ── Left: Activity feed ────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {/* Mobile header card */}
          <div className="lg:hidden bg-white rounded-2xl border border-gray-200 p-4 mb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{lead.name}</h1>
                {lead.company && <p className="text-sm text-gray-500">{lead.company}</p>}
              </div>
              <DispositionPill d={lead.disposition} />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setEditing(true)}
                className="flex-1 text-sm border border-gray-200 rounded-xl py-1.5 hover:bg-gray-50 text-gray-700"
              >
                Edit
              </button>
              <button
                onClick={() => setShowLogCall(true)}
                className="flex-1 text-sm bg-gray-900 text-white rounded-xl py-1.5 hover:bg-gray-800"
              >
                Log Call
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mb-3 overflow-x-auto">
            {(['all', 'notes', 'calls', 'tasks'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize whitespace-nowrap transition-colors ${
                  activeTab === t
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {t}
              </button>
            ))}
            <button
              onClick={() => setAddingNote(v => !v)}
              className="ml-auto text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 whitespace-nowrap"
            >
              + Add Note
            </button>
          </div>

          {/* Add note inline */}
          {addingNote && (
            <form onSubmit={submitNote} className="bg-white rounded-2xl border border-gray-200 p-4 mb-3">
              <textarea
                autoFocus
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Type a note…"
                rows={3}
                className="w-full text-sm outline-none text-gray-700 placeholder:text-gray-400 resize-none"
              />
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => { setAddingNote(false); setNoteText('') }}
                  className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!noteText.trim()}
                  className="text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-40"
                >
                  Save Note
                </button>
              </div>
            </form>
          )}

          {/* Feed */}
          <div className="space-y-3">
            {filteredFeed.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
                No activity yet.
              </div>
            )}
            {filteredFeed.map((item, i) => {
              if (item.kind === 'note') {
                const n = item.data
                return (
                  <div key={`note-${n.id}`} className="bg-white rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">N</span>
                        <span className="text-xs font-medium text-gray-600">
                          {n.author?.display_name ?? 'Unknown'} added a note
                        </span>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(n.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{n.content}</p>
                  </div>
                )
              }
              if (item.kind === 'event') {
                const ev = item.data
                return (
                  <div key={`event-${ev.id}`} className="flex items-center gap-3 px-2 py-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
                    <span className="text-xs text-gray-500">{ev.event_label}</span>
                    <span className="text-xs text-gray-300 ml-auto">{timeAgo(ev.created_at)}</span>
                  </div>
                )
              }
              if (item.kind === 'call') {
                const c = item.data
                const isAi = (c as { source?: string }).source === 'ai'
                const rec = (c as { recording_url?: string | null }).recording_url
                const transcript = (c as { transcript?: string | null }).transcript
                return (
                  <div key={`call-${c.id}`} className="bg-white rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isAi ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                          {isAi ? 'AI' : 'C'}
                        </span>
                        <span className="text-xs font-medium text-gray-600">
                          {isAi ? 'AI call' : 'Call logged'}
                          {c.duration_minutes ? ` · ${c.duration_minutes}m` : ''}
                          {c.outcome ? ` · ${c.outcome.replace(/_/g, ' ')}` : ''}
                        </span>
                        {isAi && (c as { dialer_mode?: string | null }).dialer_mode && (
                          <span className="text-[10px] bg-blue-50 text-blue-500 border border-blue-100 rounded px-1.5 py-0.5">
                            {(c as { dialer_mode?: string | null }).dialer_mode}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(c.created_at)}</span>
                    </div>
                    {c.summary && <p className="text-sm text-gray-700 mt-2">{c.summary}</p>}
                    {transcript && !c.summary && (
                      <p className="text-sm text-gray-600 mt-2 line-clamp-3">{transcript}</p>
                    )}
                    {c.next_step && (
                      <p className="text-xs text-gray-500 mt-1">
                        <span className="font-medium">Next step:</span> {c.next_step}
                      </p>
                    )}
                    {rec && (
                      <a href={rec} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 underline mt-1 block">
                        Listen to recording
                      </a>
                    )}
                  </div>
                )
              }
              if (item.kind === 'task') {
                const t = item.data
                return (
                  <div key={`task-${t.id}`} className="bg-white rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold flex-shrink-0">T</span>
                        <span className="text-xs font-medium text-gray-600 capitalize">{t.item_type} · {t.priority} priority · {t.status}</span>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(t.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-700 mt-2">{t.content}</p>
                    {t.due_date && (
                      <p className="text-xs text-gray-400 mt-1">Due {fmtDate(t.due_date)}</p>
                    )}
                  </div>
                )
              }
              return null
            })}
          </div>
        </div>

        {/* ── Right: Info sidebar ────────────────────────────────────────────── */}
        <div className="w-full lg:w-80 flex-shrink-0 space-y-4">

          {/* Header card (desktop only) */}
          <div className="hidden lg:block bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-2 mb-3">
              <h1 className="text-xl font-semibold text-gray-900 leading-tight">{lead.name}</h1>
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-gray-400 hover:text-gray-700 flex-shrink-0 border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50"
              >
                Edit
              </button>
            </div>
            {lead.company && <p className="text-sm text-gray-500 mb-3">{lead.company}</p>}

            {/* Disposition selector */}
            <div className="mb-3">
              <p className="text-xs font-medium text-gray-500 mb-1.5">Disposition</p>
              <select
                value={lead.disposition ?? 'new'}
                onChange={e => changeDisposition(e.target.value as Disposition)}
                className="w-full text-sm border rounded-xl px-3 py-2 font-medium"
                style={{
                  borderColor: dispColor.border,
                  background: dispColor.bg,
                  color: dispColor.text,
                }}
              >
                {DISPOSITION_ORDER.map(d => (
                  <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>
                ))}
              </select>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowLogCall(true)}
                className="flex-1 text-sm bg-gray-900 text-white rounded-xl py-2 hover:bg-gray-800"
              >
                Log Call
              </button>
              <button
                onClick={() => setAddingNote(v => !v)}
                className="flex-1 text-sm border border-gray-200 rounded-xl py-2 hover:bg-gray-50 text-gray-700"
              >
                Add Note
              </button>
            </div>
          </div>

          {/* Contact info */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Contact</p>
            <InfoRow label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
            <InfoRow label="Phone" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
            <InfoRow label="Source" value={lead.source} />
            <InfoRow label="Assigned" value={memberName(lead.owner_member_id)} />
            {lead.product_intent && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Product Intent</p>
                <span className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700 border border-purple-200">
                  {lead.product_intent}
                </span>
              </div>
            )}
          </div>

          {/* Timeline info */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Timeline</p>
            <InfoRow label="Lead Date" value={fmtDate(lead.lead_date)} />
            <InfoRow label="Last Contacted" value={fmtDateTime(lead.last_contacted_at)} />
            <InfoRow label="Next Follow-up" value={fmtDateTime(lead.next_followup_at)} />
            <InfoRow label="Created" value={fmtDate(lead.created_at)} />
          </div>

          {/* Flags */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Flags</p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">SMS Consent</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${lead.sms_consent ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-400'}`}>
                {lead.sms_consent ? 'Yes' : 'No'}
              </span>
            </div>
            {lead.import_batch_id && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Batch</span>
                <span className="text-xs text-gray-400 font-mono">{lead.import_batch_id.slice(0, 8)}</span>
              </div>
            )}
          </div>

          {/* Notes (lead.notes field) */}
          {lead.notes && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Quick Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{lead.notes}</p>
            </div>
          )}

          {/* AI Discovery Summary */}
          {lead.ai_discovery_summary && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">AI Discovery</p>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-x-auto">
                {JSON.stringify(lead.ai_discovery_summary, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Log Call Modal */}
      {showLogCall && (
        <LogCallModal
          leadId={lead.id}
          repId={repId}
          leadName={lead.name}
          onClose={() => setShowLogCall(false)}
          onSaved={() => {
            setShowLogCall(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ── InfoRow ───────────────────────────────────────────────────────────────────

function InfoRow({ label, value, href }: { label: string; value: string | null | undefined; href?: string }) {
  if (!value) return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm text-gray-300">—</p>
    </div>
  )
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      {href
        ? <a href={href} className="text-sm text-blue-600 hover:underline">{value}</a>
        : <p className="text-sm text-gray-700">{value}</p>
      }
    </div>
  )
}

// ── Log Call Modal ────────────────────────────────────────────────────────────

function LogCallModal({ leadId, repId, leadName, onClose, onSaved }: {
  leadId: string
  repId: string
  leadName: string
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    contact_name: leadName,
    summary: '',
    outcome: '',
    next_step: '',
    duration_minutes: '',
  })
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/call-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: leadId,
        contact_name: form.contact_name,
        summary: form.summary || null,
        outcome: form.outcome || null,
        next_step: form.next_step || null,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      }),
    }).catch(() => {})
    // Also update last_contacted_at
    await fetch(`/api/crm-leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_contacted_at: new Date().toISOString() }),
    })
    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Log Call</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contact Name</label>
            <input
              value={form.contact_name}
              onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Outcome</label>
              <select
                value={form.outcome}
                onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                <option value="positive">Positive</option>
                <option value="neutral">Neutral</option>
                <option value="negative">Negative</option>
                <option value="no_answer">No Answer</option>
                <option value="voicemail">Voicemail</option>
                <option value="booked">Booked</option>
                <option value="closed_won">Closed Won</option>
                <option value="closed_lost">Closed Lost</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Duration (min)</label>
              <input
                type="number"
                min="0"
                value={form.duration_minutes}
                onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Summary</label>
            <textarea
              value={form.summary}
              onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10 resize-none"
              placeholder="What happened on this call?"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Next Step</label>
            <input
              value={form.next_step}
              onChange={e => setForm(f => ({ ...f, next_step: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              placeholder="e.g. Follow up Friday"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-gray-900 text-white rounded-xl py-2 text-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Log Call'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
