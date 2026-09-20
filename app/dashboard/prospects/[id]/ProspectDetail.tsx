'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CrmLead, Disposition, Activity, ActivityType } from '@/types'
import type { SmsMessage } from '@/lib/crmLeads'
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

function fullAddress(lead: CrmLead): string | null {
  const parts = [lead.street, [lead.city, lead.state].filter(Boolean).join(', '), lead.zip]
    .filter(Boolean)
  return parts.length ? parts.join(' · ') : null
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

// ── activity type presentation ─────────────────────────────────────────────────

const ACTIVITY_BADGE: Record<ActivityType, { letter: string; bg: string; text: string; label: string }> = {
  note:        { letter: 'N', bg: 'bg-blue-100',   text: 'text-blue-600',   label: 'Note' },
  email:       { letter: 'E', bg: 'bg-amber-100',  text: 'text-amber-700',  label: 'Email' },
  visit:       { letter: 'V', bg: 'bg-rose-100',   text: 'text-rose-600',   label: 'Visit' },
  meeting:     { letter: 'M', bg: 'bg-indigo-100', text: 'text-indigo-600', label: 'Meeting' },
  task:        { letter: 'T', bg: 'bg-purple-100', text: 'text-purple-600', label: 'Task' },
  call:        { letter: 'C', bg: 'bg-green-100',  text: 'text-green-600',  label: 'Call' },
  sms:         { letter: 'S', bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'SMS' },
  disposition: { letter: '•', bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'Stage' },
}

// ── types ─────────────────────────────────────────────────────────────────────

type Member = { id: string; display_name: string; email: string }

type Tab = 'all' | 'calls' | 'emails' | 'sms' | 'visits' | 'notes' | 'tasks'

type Props = {
  lead: CrmLead
  activities: Activity[]
  smsMessages: SmsMessage[]
  members: Member[]
  currentMemberId: string
  repId: string
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ProspectDetail({
  lead: initialLead,
  activities: initialActivities,
  smsMessages: initialSmsMessages,
  members,
  repId,
}: Props) {
  const router = useRouter()
  const [lead, setLead] = useState(initialLead)
  const [activities, setActivities] = useState(initialActivities)
  const [smsMessages, setSmsMessages] = useState(initialSmsMessages)
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [logType, setLogType] = useState<ActivityType | null>(null)
  const [smsDraft, setSmsDraft] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const smsBottomRef = useRef<HTMLDivElement>(null)

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
    street: lead.street ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    zip: lead.zip ?? '',
  })

  useEffect(() => {
    if (activeTab === 'sms') smsBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeTab, smsMessages])

  async function refreshActivities() {
    const fresh = await fetch(`/api/crm-leads/${lead.id}/activities`).then(r => r.json())
    setActivities(fresh)
  }

  async function sendSms(e: React.FormEvent) {
    e.preventDefault()
    if (!smsDraft.trim() || smsSending) return
    setSmsSending(true)
    const body = smsDraft.trim()
    setSmsDraft('')
    const res = await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: lead.id, body }),
    })
    if (res.ok) {
      setSmsMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        lead_id: lead.id,
        direction: 'outbound',
        body,
        from_phone: '',
        to_phone: lead.phone ?? '',
        status: 'sent',
        is_ai_reply: false,
        created_at: new Date().toISOString(),
      }])
    }
    setSmsSending(false)
  }

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
      street: editForm.street || null,
      city: editForm.city || null,
      state: editForm.state || null,
      zip: editForm.zip || null,
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
    void refreshActivities()
  }

  const filteredFeed = activities.filter(a => {
    if (activeTab === 'all') return a.type !== 'sms' // SMS has its own chat view
    if (activeTab === 'calls') return a.type === 'call'
    if (activeTab === 'emails') return a.type === 'email'
    if (activeTab === 'visits') return a.type === 'visit' || a.type === 'meeting'
    if (activeTab === 'notes') return a.type === 'note'
    if (activeTab === 'tasks') return a.type === 'task'
    return false
  })

  const dispColor = DISPOSITION_COLOR[lead.disposition ?? 'new']
  const TABS: Tab[] = ['all', 'calls', 'emails', 'sms', 'visits', 'notes', 'tasks']

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
            {/* Address */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Street Address</label>
              <input
                value={editForm.street}
                onChange={e => setEditForm(f => ({ ...f, street: e.target.value }))}
                placeholder="123 Main St"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
              <input
                value={editForm.city}
                onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                <input
                  value={editForm.state}
                  onChange={e => setEditForm(f => ({ ...f, state: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">ZIP</label>
                <input
                  value={editForm.zip}
                  onChange={e => setEditForm(f => ({ ...f, zip: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
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

  const address = fullAddress(lead)

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
                onClick={() => setLogType('call')}
                className="flex-1 text-sm bg-gray-900 text-white rounded-xl py-1.5 hover:bg-gray-800"
              >
                Log Activity
              </button>
            </div>
          </div>

          {/* Tabs + log menu */}
          <div className="flex items-center gap-1 mb-3 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize whitespace-nowrap transition-colors ${
                  activeTab === t
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {t === 'sms' ? `SMS${smsMessages.length > 0 ? ` (${smsMessages.length})` : ''}` : t}
              </button>
            ))}
            <LogMenu onPick={setLogType} />
          </div>

          {/* SMS chat view */}
          {activeTab === 'sms' && (
            <div className="bg-white rounded-2xl border border-gray-200 flex flex-col" style={{ minHeight: 400 }}>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1" style={{ maxHeight: 500 }}>
                {smsMessages.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-8">No SMS messages yet.</p>
                )}
                {smsMessages.map((msg, i) => {
                  const isOut = msg.direction === 'outbound'
                  const prev = smsMessages[i - 1]
                  const sameDir = prev?.direction === msg.direction
                  return (
                    <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'} ${sameDir ? 'mt-0.5' : 'mt-2'}`}>
                      <div className="max-w-[72%] group">
                        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                          isOut ? 'bg-gray-900 text-white rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                        }`}>
                          {msg.body}
                        </div>
                        <div className={`flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${isOut ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-[10px] text-gray-400">{timeAgo(msg.created_at)}</span>
                          {isOut && (
                            <span className="text-[10px] text-gray-400">
                              · {msg.is_ai_reply ? 'AI' : 'You'} · {msg.status}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={smsBottomRef} />
              </div>
              <form onSubmit={sendSms} className="border-t border-gray-100 px-3 py-3 flex items-end gap-2">
                <textarea
                  value={smsDraft}
                  onChange={e => setSmsDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSms(e as unknown as React.FormEvent) } }}
                  placeholder={lead.phone ? 'Type a message… (Enter to send)' : 'No phone number on file'}
                  disabled={!lead.phone}
                  rows={2}
                  className="flex-1 text-sm bg-gray-50 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10 resize-none placeholder:text-gray-400 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!smsDraft.trim() || smsSending || !lead.phone}
                  className="flex-shrink-0 bg-gray-900 text-white text-sm px-4 py-2 rounded-xl hover:bg-gray-800 disabled:opacity-40 h-[42px]"
                >
                  {smsSending ? '…' : 'Send'}
                </button>
              </form>
            </div>
          )}

          {/* Feed */}
          {activeTab !== 'sms' && <div className="space-y-3">
            {filteredFeed.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
                No activity yet.
              </div>
            )}
            {filteredFeed.map(item => <ActivityCard key={`${item.type}-${item.id}`} a={item} />)}
          </div>}
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
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setLogType('call')} className="text-sm bg-gray-900 text-white rounded-xl py-2 hover:bg-gray-800">Log Call</button>
              <button onClick={() => setLogType('email')} className="text-sm border border-gray-200 rounded-xl py-2 hover:bg-gray-50 text-gray-700">Log Email</button>
              <button onClick={() => setLogType('visit')} className="text-sm border border-gray-200 rounded-xl py-2 hover:bg-gray-50 text-gray-700">Log Visit</button>
              <button onClick={() => setLogType('note')} className="text-sm border border-gray-200 rounded-xl py-2 hover:bg-gray-50 text-gray-700">Add Note</button>
            </div>
          </div>

          {/* Contact info */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Contact</p>
            <InfoRow label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
            <InfoRow label="Phone" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
            <InfoRow
              label="Location"
              value={address}
              href={address ? `https://maps.google.com/?q=${encodeURIComponent(address.replace(/ · /g, ' '))}` : undefined}
            />
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

      {/* Log Activity Modal */}
      {logType && (
        <LogActivityModal
          initialType={logType}
          leadId={lead.id}
          leadName={lead.name}
          leadAddress={address}
          onClose={() => setLogType(null)}
          onSaved={async () => {
            setLogType(null)
            await refreshActivities()
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ── LogMenu (dropdown to pick what to log) ─────────────────────────────────────

function LogMenu({ onPick }: { onPick: (t: ActivityType) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const items: { type: ActivityType; label: string }[] = [
    { type: 'call', label: 'Log Call' },
    { type: 'email', label: 'Log Email' },
    { type: 'visit', label: 'Log Visit' },
    { type: 'meeting', label: 'Log Meeting' },
    { type: 'note', label: 'Add Note' },
  ]
  return (
    <div ref={ref} className="relative ml-auto">
      <button
        onClick={() => setOpen(v => !v)}
        className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800 whitespace-nowrap"
      >
        + Log
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-20">
          {items.map(it => (
            <button
              key={it.type}
              onClick={() => { onPick(it.type); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ActivityCard (renders any normalized Activity) ─────────────────────────────

function ActivityCard({ a }: { a: Activity }) {
  const [showTranscript, setShowTranscript] = useState(false)
  const badge = ACTIVITY_BADGE[a.type]

  // Stage change → compact line
  if (a.type === 'disposition') {
    return (
      <div className="flex items-center gap-3 px-2 py-1">
        <div className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
        <span className="text-xs text-gray-500">{a.body}</span>
        <span className="text-xs text-gray-300 ml-auto">{timeAgo(a.occurred_at)}</span>
      </div>
    )
  }

  const p = a.payload
  let headline = badge.label
  if (a.type === 'call') {
    headline = (a.source === 'ai' ? 'AI call' : 'Call logged')
      + (p.duration_minutes ? ` · ${p.duration_minutes}m` : '')
      + (p.outcome ? ` · ${String(p.outcome).replace(/_/g, ' ')}` : '')
  } else if (a.type === 'email') {
    headline = `Email ${p.direction === 'inbound' ? 'received' : 'sent'}`
  } else if (a.type === 'visit' || a.type === 'meeting') {
    headline = `${badge.label}${p.outcome ? ` · ${String(p.outcome).replace(/_/g, ' ')}` : ''}`
  } else if (a.type === 'task') {
    headline = `${p.item_type ?? 'Task'}${p.priority ? ` · ${p.priority} priority` : ''}${p.status ? ` · ${p.status}` : ''}`
  } else if (a.type === 'note') {
    headline = `${a.author_name ?? 'Someone'} added a note`
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${badge.bg} ${badge.text}`}>
            {badge.letter}
          </span>
          <span className="text-xs font-medium text-gray-600 capitalize">{headline}</span>
          {a.type === 'call' && p.dialer_mode && (
            <span className="text-[10px] bg-blue-50 text-blue-500 border border-blue-100 rounded px-1.5 py-0.5">{String(p.dialer_mode)}</span>
          )}
        </div>
        <span className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(a.occurred_at)}</span>
      </div>

      {a.type === 'email' && p.subject && (
        <p className="text-sm font-medium text-gray-800 mt-2">{String(p.subject)}</p>
      )}
      {(a.type === 'visit' || a.type === 'meeting') && p.address && (
        <p className="text-xs text-gray-500 mt-1">📍 {String(p.address)}</p>
      )}
      {a.body && <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{a.body}</p>}
      {p.next_step && (
        <p className="text-xs text-gray-500 mt-1"><span className="font-medium">Next step:</span> {String(p.next_step)}</p>
      )}
      {a.type === 'task' && p.due_date && (
        <p className="text-xs text-gray-400 mt-1">Due {fmtDate(String(p.due_date))}</p>
      )}

      {(p.recording_url || p.transcript) && (
        <div className="flex items-center gap-3 mt-2">
          {p.recording_url && (
            <a href={String(p.recording_url)} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 underline">Listen to recording</a>
          )}
          {p.transcript && (
            <button onClick={() => setShowTranscript(v => !v)} className="text-xs text-gray-500 hover:text-gray-700">
              {showTranscript ? 'Hide transcript ▲' : 'View transcript ▼'}
            </button>
          )}
        </div>
      )}
      {showTranscript && p.transcript && (
        <div className="mt-3 bg-gray-50 rounded-xl p-3 text-xs text-gray-600 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed border border-gray-100">
          {String(p.transcript)}
        </div>
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
        ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">{value}</a>
        : <p className="text-sm text-gray-700">{value}</p>
      }
    </div>
  )
}

// ── Log Activity Modal (unified: call / email / visit / meeting / note) ─────────

const LOG_OUTCOMES: Record<string, { value: string; label: string }[]> = {
  call: [
    { value: 'positive', label: 'Positive' }, { value: 'neutral', label: 'Neutral' },
    { value: 'negative', label: 'Negative' }, { value: 'no_answer', label: 'No Answer' },
    { value: 'voicemail', label: 'Voicemail' }, { value: 'booked', label: 'Booked' },
    { value: 'closed_won', label: 'Closed Won' }, { value: 'closed_lost', label: 'Closed Lost' },
  ],
  visit: [
    { value: 'not_home', label: 'Not Home' }, { value: 'spoke', label: 'Spoke With' },
    { value: 'interested', label: 'Interested' }, { value: 'callback', label: 'Callback' },
    { value: 'booked', label: 'Booked' }, { value: 'closed_won', label: 'Closed Won' },
    { value: 'not_interested', label: 'Not Interested' },
  ],
  meeting: [
    { value: 'held', label: 'Held' }, { value: 'no_show', label: 'No Show' },
    { value: 'rescheduled', label: 'Rescheduled' }, { value: 'closed_won', label: 'Closed Won' },
    { value: 'closed_lost', label: 'Closed Lost' },
  ],
}

const LOG_TITLE: Record<ActivityType, string> = {
  call: 'Log Call', email: 'Log Email', visit: 'Log Visit', meeting: 'Log Meeting',
  note: 'Add Note', task: 'Log Task', sms: 'Log SMS', disposition: 'Stage Change',
}

function LogActivityModal({ initialType, leadId, leadName, leadAddress, onClose, onSaved }: {
  initialType: ActivityType
  leadId: string
  leadName: string
  leadAddress: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<ActivityType>(initialType)
  const [body, setBody] = useState('')
  const [outcome, setOutcome] = useState('')
  const [duration, setDuration] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [subject, setSubject] = useState('')
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('outbound')
  const [address, setAddress] = useState(leadAddress ?? '')
  const [saving, setSaving] = useState(false)

  const TYPES: ActivityType[] = ['call', 'email', 'visit', 'meeting', 'note']
  const outcomes = LOG_OUTCOMES[type] ?? []

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (type === 'note' && !body.trim()) return
    setSaving(true)
    const payload: Record<string, unknown> = {}
    if (type === 'call') {
      if (outcome) payload.outcome = outcome
      if (duration) payload.duration_minutes = Number(duration)
      if (nextStep) payload.next_step = nextStep
    } else if (type === 'email') {
      payload.direction = direction
      if (subject) payload.subject = subject
    } else if (type === 'visit' || type === 'meeting') {
      if (outcome) payload.outcome = outcome
      if (address) payload.address = address
      if (nextStep) payload.next_step = nextStep
    }
    await fetch(`/api/crm-leads/${leadId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, body: body || null, contactName: leadName, payload }),
    }).catch(() => {})
    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{LOG_TITLE[type]}</h2>

        {/* Type switcher */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
          {TYPES.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-lg capitalize transition-colors ${
                type === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {type === 'email' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Direction</label>
                  <select value={direction} onChange={e => setDirection(e.target.value as 'inbound' | 'outbound')} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                    <option value="outbound">Sent</option>
                    <option value="inbound">Received</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                  <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10" />
                </div>
              </div>
            </>
          )}

          {(type === 'visit' || type === 'meeting') && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Where did this happen?" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10" />
            </div>
          )}

          {outcomes.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Outcome</label>
                <select value={outcome} onChange={e => setOutcome(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  <option value="">Select…</option>
                  {outcomes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {type === 'call' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Duration (min)</label>
                  <input type="number" min="0" value={duration} onChange={e => setDuration(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10" />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {type === 'note' ? 'Note *' : type === 'email' ? 'Body' : 'Summary'}
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10 resize-none"
              placeholder={type === 'note' ? 'Type a note…' : type === 'email' ? 'What did the email say?' : 'What happened?'}
            />
          </div>

          {(type === 'call' || type === 'visit' || type === 'meeting') && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Next Step</label>
              <input value={nextStep} onChange={e => setNextStep(e.target.value)} placeholder="e.g. Follow up Friday" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10" />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button
              type="submit"
              disabled={saving || (type === 'note' && !body.trim())}
              className="flex-1 bg-gray-900 text-white rounded-xl py-2 text-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : LOG_TITLE[type]}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
