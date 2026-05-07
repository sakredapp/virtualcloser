'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CrmLead, Disposition } from '@/types'
import {
  DISPOSITION_ORDER,
  DISPOSITION_LABEL,
  DISPOSITION_COLOR,
} from '@/lib/crmLeads'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function DispositionPill({ d }: { d: Disposition | null }) {
  if (!d) {
    const c = DISPOSITION_COLOR['new']
    return (
      <span
        style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
        className="px-2 py-0.5 rounded-full text-xs font-medium"
      >
        New
      </span>
    )
  }
  const c = DISPOSITION_COLOR[d]
  return (
    <span
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
      className="px-2 py-0.5 rounded-full text-xs font-medium"
    >
      {DISPOSITION_LABEL[d]}
    </span>
  )
}

// ── types ─────────────────────────────────────────────────────────────────────

type Member = { id: string; display_name: string; email: string }

type Props = {
  initialLeads: CrmLead[]
  members: Member[]
  currentMemberId: string
  repId: string
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ProspectsClient({ initialLeads, members, currentMemberId, repId }: Props) {
  const router = useRouter()
  const [leads, setLeads] = useState(initialLeads)
  const [view, setView] = useState<'list' | 'kanban'>('list')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterDisposition, setFilterDisposition] = useState<Disposition | ''>('')
  const [filterIntent, setFilterIntent] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [bulkDisposition, setBulkDisposition] = useState<Disposition | ''>('')
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [saving, setSaving] = useState(false)

  // Derived filter
  const filtered = leads.filter(l => {
    if (search && !`${l.name} ${l.email ?? ''} ${l.phone ?? ''} ${l.company ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false
    if (filterSource && l.source !== filterSource) return false
    if (filterAssignee && l.owner_member_id !== filterAssignee) return false
    if (filterDisposition && (l.disposition ?? 'new') !== filterDisposition) return false
    if (filterIntent && l.product_intent !== filterIntent) return false
    return true
  })

  const allChecked = filtered.length > 0 && selected.size === filtered.length
  const sources = Array.from(new Set(leads.map(l => l.source).filter(Boolean))) as string[]
  const intents = Array.from(new Set(leads.map(l => l.product_intent).filter(Boolean))) as string[]
  const hasFilter = !!(search || filterSource || filterAssignee || filterDisposition || filterIntent)

  function toggleAll() {
    if (allChecked) setSelected(new Set())
    else setSelected(new Set(filtered.map(l => l.id)))
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  async function applyBulk(action: 'disposition' | 'assign', value: string) {
    if (!value || selected.size === 0) return
    setSaving(true)
    await fetch('/api/crm-leads/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selected), action, value }),
    })
    const fresh = await fetch('/api/crm-leads').then(r => r.json())
    setLeads(fresh)
    setSelected(new Set())
    setSaving(false)
    setBulkDisposition('')
    setBulkAssignee('')
  }

  async function moveCard(leadId: string, newDisposition: Disposition) {
    // Optimistic update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, disposition: newDisposition } : l))
    await fetch(`/api/crm-leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposition: newDisposition }),
    })
  }

  function memberName(id: string | null) {
    if (!id) return null
    return members.find(m => m.id === id)?.display_name ?? null
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-semibold text-gray-900">Prospects</h1>
          <p className="text-sm text-gray-500 mt-0.5">{leads.length} total leads</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* List / Kanban toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1.5 ${view === 'list' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              List
            </button>
            <button
              onClick={() => setView('kanban')}
              className={`px-3 py-1.5 border-l border-gray-200 ${view === 'kanban' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              Pipeline
            </button>
          </div>
          <button className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700">
            Bulk Import
          </button>
          <button className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700">
            Export CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800"
          >
            + Add Prospect
          </button>
        </div>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm">
          <span className="font-medium text-gray-700">{selected.size} selected</span>
          <div className="w-px h-4 bg-gray-200" />
          <select
            value={bulkAssignee}
            onChange={e => { setBulkAssignee(e.target.value); if (e.target.value) applyBulk('assign', e.target.value) }}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1"
          >
            <option value="">Assign To…</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
          <select
            value={bulkDisposition}
            onChange={e => { setBulkDisposition(e.target.value as Disposition); if (e.target.value) applyBulk('disposition', e.target.value) }}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1"
          >
            <option value="">Set Disposition…</option>
            {DISPOSITION_ORDER.map(d => <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>)}
          </select>
          <button className="text-sm px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">
            Enroll AI SMS
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-sm text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, phone…"
          className="flex-1 min-w-[180px] text-sm outline-none text-gray-700 placeholder:text-gray-400"
        />
        <select
          value={filterSource}
          onChange={e => setFilterSource(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1 text-gray-700"
        >
          <option value="">Source</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterAssignee}
          onChange={e => setFilterAssignee(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1 text-gray-700"
        >
          <option value="">Assignee</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        <select
          value={filterDisposition}
          onChange={e => setFilterDisposition(e.target.value as Disposition | '')}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1 text-gray-700"
        >
          <option value="">Disposition</option>
          {DISPOSITION_ORDER.map(d => <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>)}
        </select>
        <select
          value={filterIntent}
          onChange={e => setFilterIntent(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1 text-gray-700"
        >
          <option value="">Product Intent</option>
          {intents.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        {hasFilter && (
          <button
            onClick={() => { setSearch(''); setFilterSource(''); setFilterAssignee(''); setFilterDisposition(''); setFilterIntent('') }}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
      </div>

      {/* Views */}
      {view === 'list' ? (
        <ListView
          leads={filtered}
          selected={selected}
          onToggleAll={toggleAll}
          onToggleOne={toggleOne}
          onMemberName={memberName}
          repId={repId}
        />
      ) : (
        <KanbanView
          leads={filtered}
          onMove={moveCard}
          onMemberName={memberName}
          repId={repId}
        />
      )}

      {/* Add modal */}
      {showAddModal && (
        <AddProspectModal
          members={members}
          repId={repId}
          onClose={() => setShowAddModal(false)}
          onCreated={l => { setLeads(prev => [l, ...prev]); setShowAddModal(false) }}
        />
      )}
    </div>
  )
}

// ── List View ─────────────────────────────────────────────────────────────────

function ListView({
  leads, selected, onToggleAll, onToggleOne, onMemberName, repId,
}: {
  leads: CrmLead[]
  selected: Set<string>
  onToggleAll: () => void
  onToggleOne: (id: string) => void
  onMemberName: (id: string | null) => string | null
  repId: string
}) {
  const router = useRouter()
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={leads.length > 0 && selected.size === leads.length}
                  onChange={onToggleAll}
                  className="rounded"
                />
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Intent</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Disposition</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Assigned</th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-gray-400">No prospects yet.</td>
              </tr>
            )}
            {leads.map(l => (
              <tr
                key={l.id}
                className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${selected.has(l.id) ? 'bg-blue-50' : ''}`}
              >
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={() => onToggleOne(l.id)}
                    className="rounded"
                  />
                </td>
                <td className="px-4 py-3 font-medium text-gray-900" onClick={() => router.push(`/dashboard/prospects/${l.id}`)}>
                  {l.name}
                </td>
                <td className="px-4 py-3 text-gray-500" onClick={() => router.push(`/dashboard/prospects/${l.id}`)}>
                  {l.email ?? '—'}
                </td>
                <td className="px-4 py-3 text-gray-500" onClick={() => router.push(`/dashboard/prospects/${l.id}`)}>
                  {l.phone ?? '—'}
                </td>
                <td className="px-4 py-3" onClick={() => router.push(`/dashboard/prospects/${l.id}`)}>
                  {l.product_intent
                    ? <span className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700 border border-purple-200">{l.product_intent}</span>
                    : <span className="text-gray-300">—</span>
                  }
                </td>
                <td className="px-4 py-3 text-gray-500" onClick={() => router.push(`/dashboard/prospects/${l.id}`)}>
                  {l.source ?? '—'}
                </td>
                <td className="px-4 py-3" onClick={() => router.push(`/dashboard/prospects/${l.id}`)}>
                  <DispositionPill d={l.disposition} />
                </td>
                <td className="px-4 py-3 text-gray-500" onClick={() => router.push(`/dashboard/prospects/${l.id}`)}>
                  {onMemberName(l.owner_member_id) ?? '—'}
                </td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <Link href={`/dashboard/prospects/${l.id}`} className="text-gray-300 hover:text-gray-600">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-center text-xs text-gray-400 py-3">
        {leads.length} prospect{leads.length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}

// ── Kanban View ───────────────────────────────────────────────────────────────

const LS_COL_ORDER_KEY = 'vc_prospects_col_order'

function KanbanView({
  leads, onMove, onMemberName, repId,
}: {
  leads: CrmLead[]
  onMove: (id: string, d: Disposition) => void
  onMemberName: (id: string | null) => string | null
  repId: string
}) {
  const router = useRouter()
  const [colOrder, setColOrder] = useState<Disposition[]>(() => {
    if (typeof window === 'undefined') return DISPOSITION_ORDER
    try {
      const saved = localStorage.getItem(LS_COL_ORDER_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return DISPOSITION_ORDER
  })
  const [draggingCard, setDraggingCard] = useState<string | null>(null)
  const [draggingCol, setDraggingCol] = useState<Disposition | null>(null)
  const [overCol, setOverCol] = useState<Disposition | null>(null)
  const [draggingColOver, setDraggingColOver] = useState<Disposition | null>(null)

  const byDisp = colOrder.reduce((acc, d) => {
    acc[d] = leads.filter(l => (l.disposition ?? 'new') === d)
    return acc
  }, {} as Record<Disposition, CrmLead[]>)

  function saveColOrder(order: Disposition[]) {
    setColOrder(order)
    localStorage.setItem(LS_COL_ORDER_KEY, JSON.stringify(order))
  }

  // Card drag
  function onCardDragStart(e: React.DragEvent, leadId: string) {
    e.dataTransfer.setData('leadId', leadId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingCard(leadId)
  }
  function onColDragOver(e: React.DragEvent, d: Disposition) {
    if (!draggingCard) return
    e.preventDefault()
    setOverCol(d)
  }
  function onColDrop(e: React.DragEvent, d: Disposition) {
    e.preventDefault()
    const leadId = e.dataTransfer.getData('leadId')
    if (leadId) onMove(leadId, d)
    setDraggingCard(null)
    setOverCol(null)
  }

  // Column drag
  function onColHeaderDragStart(e: React.DragEvent, d: Disposition) {
    e.dataTransfer.setData('colDisp', d)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingCol(d)
  }
  function onColHeaderDragOver(e: React.DragEvent, d: Disposition) {
    if (!draggingCol) return
    e.preventDefault()
    setDraggingColOver(d)
  }
  function onColHeaderDrop(e: React.DragEvent, targetD: Disposition) {
    e.preventDefault()
    const srcD = e.dataTransfer.getData('colDisp') as Disposition
    if (!srcD || srcD === targetD) { setDraggingCol(null); setDraggingColOver(null); return }
    const next = [...colOrder]
    const si = next.indexOf(srcD)
    const ti = next.indexOf(targetD)
    next.splice(si, 1)
    next.splice(ti, 0, srcD)
    saveColOrder(next)
    setDraggingCol(null)
    setDraggingColOver(null)
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-2">
        <button
          onClick={() => saveColOrder(DISPOSITION_ORDER)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Reset column order
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ height: 'calc(100vh - 340px)' }}>
        {colOrder.map(d => {
          const cards = byDisp[d] ?? []
          const color = DISPOSITION_COLOR[d]
          const isColOver = draggingColOver === d
          return (
            <div
              key={d}
              className="flex-none w-64 flex flex-col rounded-xl overflow-hidden border"
              style={{
                borderColor: color.border,
                opacity: draggingCol === d ? 0.5 : 1,
                outline: isColOver ? `2px dashed ${color.border}` : 'none',
              }}
              onDragOver={e => { onColDragOver(e, d); onColHeaderDragOver(e, d) }}
              onDrop={e => { onColDrop(e, d); onColHeaderDrop(e, d) }}
            >
              {/* Column header */}
              <div
                draggable
                onDragStart={e => onColHeaderDragStart(e, d)}
                className="flex items-center justify-between px-3 py-2 cursor-grab select-none"
                style={{ background: color.bg, borderBottom: `2px solid ${color.border}` }}
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: color.text }}
                >
                  {DISPOSITION_LABEL[d]}
                </span>
                <span
                  className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                  style={{ background: color.border + '33', color: color.text }}
                >
                  {cards.length}
                </span>
              </div>
              {/* Cards */}
              <div
                className="flex-1 overflow-y-auto p-2 space-y-2"
                style={{ background: color.bg + '66' }}
              >
                {cards.map(l => (
                  <div
                    key={l.id}
                    draggable
                    onDragStart={e => onCardDragStart(e, l.id)}
                    onDragEnd={() => setDraggingCard(null)}
                    className="bg-white rounded-xl border p-3 text-sm cursor-grab active:cursor-grabbing select-none"
                    style={{
                      borderColor: color.border + '66',
                      opacity: draggingCard === l.id ? 0.4 : 1,
                    }}
                  >
                    <div
                      className="cursor-pointer"
                      onClick={() => router.push(`/dashboard/prospects/${l.id}`)}
                    >
                      <p className="font-medium text-gray-900 leading-tight">{l.name}</p>
                      {l.company && <p className="text-xs text-gray-400 mt-0.5">{l.company}</p>}
                      <p className="text-xs text-gray-400 mt-0.5">{fmtDate(l.created_at)}</p>
                    </div>
                    <div className="border-t border-gray-100 mt-2 pt-2 flex items-center justify-between">
                      <select
                        value={d}
                        onChange={e => { e.stopPropagation(); onMove(l.id, e.target.value as Disposition) }}
                        onClick={e => e.stopPropagation()}
                        className="text-xs border border-gray-200 rounded-lg px-1.5 py-0.5 bg-white text-gray-600 max-w-[120px]"
                      >
                        {DISPOSITION_ORDER.map(opt => (
                          <option key={opt} value={opt}>{DISPOSITION_LABEL[opt]}</option>
                        ))}
                      </select>
                      <Link
                        href={`/dashboard/prospects/${l.id}`}
                        onClick={e => e.stopPropagation()}
                        className="text-gray-300 hover:text-gray-500"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Add Prospect Modal ────────────────────────────────────────────────────────

function AddProspectModal({ members, repId, onClose, onCreated }: {
  members: Member[]
  repId: string
  onClose: () => void
  onCreated: (l: CrmLead) => void
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    source: '',
    product_intent: '',
    disposition: 'new' as Disposition,
    owner_member_id: '',
  })
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    const res = await fetch('/api/crm-leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, owner_member_id: form.owner_member_id || null }),
    })
    const lead = await res.json()
    onCreated(lead)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Prospect</h2>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Full name *"
              className="col-span-2 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <input
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="Email"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <input
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="Phone"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <input
              value={form.company}
              onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
              placeholder="Company"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <input
              value={form.source}
              onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
              placeholder="Source"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <input
              value={form.product_intent}
              onChange={e => setForm(f => ({ ...f, product_intent: e.target.value }))}
              placeholder="Product intent"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <select
              value={form.disposition}
              onChange={e => setForm(f => ({ ...f, disposition: e.target.value as Disposition }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
            >
              {DISPOSITION_ORDER.map(d => <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>)}
            </select>
            <select
              value={form.owner_member_id}
              onChange={e => setForm(f => ({ ...f, owner_member_id: e.target.value }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500"
            >
              <option value="">Assign to…</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
            </select>
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
              {saving ? 'Saving…' : 'Add Prospect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
