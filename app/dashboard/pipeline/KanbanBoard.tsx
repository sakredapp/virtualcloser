'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type {
  Pipeline,
  PipelineStage,
  PipelineLead,
  PipelineItem,
  PipelineKind,
} from '@/lib/pipelines'

// ── colour palette ───────────────────────────────────────────────────────────
const STAGE_COLORS = [
  '#3b82f6', // blue
  '#14b8a6', // teal
  '#a855f7', // purple
  '#f59e0b', // amber
  '#22c55e', // green
  '#ef4444', // red (lost-style)
  '#64748b', // slate
  '#ec4899', // pink
]

const STATUS_DOT: Record<string, string> = {
  hot: '#ff2800',
  warm: '#e02400',
  cold: '#ff7a59',
  dormant: '#9ca3af',
  open: '#ff7a59',
  active: '#ff2800',
  blocked: '#c21a00',
  done: '#b91c1c',
  archived: '#cbd5e1',
}

const KIND_LABEL: Record<PipelineKind, { label: string; cardNoun: string }> = {
  sales:      { label: 'Sales', cardNoun: 'lead' },
  recruiting: { label: 'Recruiting', cardNoun: 'candidate' },
  team:       { label: 'Team', cardNoun: 'teammate' },
  project:    { label: 'Project', cardNoun: 'task' },
  custom:     { label: 'Custom', cardNoun: 'card' },
}

function fmt(n: number | null) {
  if (!n) return null
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return `$${n}`
}

function statusLabel(key: string) {
  return key.replace(/_/g, ' ')
}

// Unified card shape (a lead OR a generic item) for rendering in one place.
type Card = {
  id: string
  title: string
  subtitle: string | null
  statusKey: string
  value: number | null
  pipeline_stage_id: string | null
  source: 'lead' | 'item'
}

function leadToCard(l: PipelineLead): Card {
  return {
    id: l.id,
    title: l.name,
    subtitle: l.company,
    statusKey: l.status,
    value: l.deal_value,
    pipeline_stage_id: l.pipeline_stage_id,
    source: 'lead',
  }
}
function itemToCard(i: PipelineItem): Card {
  return {
    id: i.id,
    title: i.title,
    subtitle: i.subtitle,
    statusKey: i.status,
    value: i.value,
    pipeline_stage_id: i.pipeline_stage_id,
    source: 'item',
  }
}

// ── props ────────────────────────────────────────────────────────────────────
type Props = {
  initialPipelines: Pipeline[]
  initialPipelineLeads: Record<string, PipelineLead[]>
  initialPipelineItems: Record<string, PipelineItem[]>
  initialUnassigned: PipelineLead[]
}

export default function KanbanBoard({
  initialPipelines,
  initialPipelineLeads,
  initialPipelineItems,
  initialUnassigned,
}: Props) {
  const router = useRouter()
  const [pipelines, setPipelines] = useState<Pipeline[]>(initialPipelines)
  const [pipelineLeads, setPipelineLeads] = useState(initialPipelineLeads)
  const [pipelineItems, setPipelineItems] = useState(initialPipelineItems)
  const [unassigned, setUnassigned] = useState<PipelineLead[]>(initialUnassigned)
  const [activePipelineId, setActivePipelineId] = useState<string | null>(
    initialPipelines[0]?.id ?? null,
  )

  // UI states
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(null)
  const [pipelineNameDraft, setPipelineNameDraft] = useState('')
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [stageNameDraft, setStageNameDraft] = useState('')
  const [creatingPipeline, setCreatingPipeline] = useState(false)
  const [newPipelineName, setNewPipelineName] = useState('')
  const [newPipelineKind, setNewPipelineKind] = useState<PipelineKind>('sales')
  const [newPipelineDescription, setNewPipelineDescription] = useState('')
  const [addingStage, setAddingStage] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [busy, setBusy] = useState(false)
  const [movingCardKey, setMovingCardKey] = useState<string | null>(null)
  const [confirmDeletePipelineId, setConfirmDeletePipelineId] = useState<string | null>(null)
  const [confirmDeleteStageId, setConfirmDeleteStageId] = useState<string | null>(null)
  const [openPipelineMenuId, setOpenPipelineMenuId] = useState<string | null>(null)

  // Add-card (for non-sales pipelines)
  const [addingCardStageId, setAddingCardStageId] = useState<string | null>(null)
  const [newCardTitle, setNewCardTitle] = useState('')
  const [newCardSubtitle, setNewCardSubtitle] = useState('')

  // Add-lead (sales pipelines)
  const [showLeadForm, setShowLeadForm] = useState(false)
  const [newLeadName, setNewLeadName] = useState('')
  const [newLeadCompany, setNewLeadCompany] = useState('')
  const [newLeadValue, setNewLeadValue] = useState('')
  const [newLeadStatus, setNewLeadStatus] = useState('warm')
  const [newLeadStageId, setNewLeadStageId] = useState<string>('')

  // drag-and-drop — refs for the dragged card, state for the highlight.
  const dragCardId = useRef<string | null>(null)
  const dragCardSource = useRef<'lead' | 'item' | null>(null)
  const dragStageId = useRef<string | null>(null)
  const [dragOverStageKey, setDragOverStageKey] = useState<string | null>(null)
  const [openStageMenuId, setOpenStageMenuId] = useState<string | null>(null)

  const activePipeline = pipelines.find((p) => p.id === activePipelineId) ?? null
  const activeKind: PipelineKind = activePipeline?.kind ?? 'sales'
  const isSales = activeKind === 'sales'

  const activeCards: Card[] = activePipelineId
    ? isSales
      ? (pipelineLeads[activePipelineId] ?? []).map(leadToCard)
      : (pipelineItems[activePipelineId] ?? []).map(itemToCard)
    : []

  // ── helpers ────────────────────────────────────────────────────────────────

  async function api(method: string, url: string, body?: object) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }

  function updateActivePipeline(updater: (p: Pipeline) => Pipeline) {
    if (!activePipelineId) return
    setPipelines((prev) =>
      prev.map((p) => (p.id === activePipelineId ? updater(p) : p)),
    )
  }

  // ── pipeline actions ───────────────────────────────────────────────────────

  async function handleCreatePipeline() {
    if (!newPipelineName.trim()) return
    setBusy(true)
    try {
      const data = await api('POST', '/api/pipeline', {
        name: newPipelineName.trim(),
        kind: newPipelineKind,
        description: newPipelineDescription.trim() || null,
      })
      const p = data.pipeline as Pipeline
      setPipelines((prev) => [...prev, p])
      if (p.kind === 'sales') {
        setPipelineLeads((prev) => ({ ...prev, [p.id]: [] }))
      } else {
        setPipelineItems((prev) => ({ ...prev, [p.id]: [] }))
      }
      setActivePipelineId(p.id)
      setCreatingPipeline(false)
      setNewPipelineName('')
      setNewPipelineDescription('')
      setNewPipelineKind('sales')
    } finally {
      setBusy(false)
    }
  }

  async function handleRenamePipeline(id: string) {
    if (!pipelineNameDraft.trim()) {
      setEditingPipelineId(null)
      setPipelineNameDraft('')
      return
    }
    setBusy(true)
    try {
      await api('PATCH', `/api/pipeline/${id}`, { name: pipelineNameDraft.trim() })
      setPipelines((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: pipelineNameDraft.trim() } : p)),
      )
      setEditingPipelineId(null)
      setPipelineNameDraft('')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeletePipeline(id: string) {
    setBusy(true)
    try {
      await api('DELETE', `/api/pipeline/${id}`)
      setPipelines((prev) => prev.filter((p) => p.id !== id))
      setPipelineLeads((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setPipelineItems((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setActivePipelineId((cur) => {
        if (cur !== id) return cur
        const remaining = pipelines.filter((p) => p.id !== id)
        return remaining[0]?.id ?? null
      })
      setConfirmDeletePipelineId(null)
    } finally {
      setBusy(false)
    }
  }

  // ── stage actions ──────────────────────────────────────────────────────────

  async function handleAddStage() {
    if (!activePipelineId || !newStageName.trim()) return
    setBusy(true)
    try {
      const data = await api('POST', `/api/pipeline/${activePipelineId}/stages`, {
        name: newStageName.trim(),
        color: STAGE_COLORS[(activePipeline?.stages.length ?? 0) % STAGE_COLORS.length],
      })
      const stage = data.stage as PipelineStage
      updateActivePipeline((p) => ({ ...p, stages: [...p.stages, stage] }))
      setAddingStage(false)
      setNewStageName('')
    } finally {
      setBusy(false)
    }
  }

  async function handleRenameStage(stageId: string) {
    if (!activePipelineId) return
    if (!stageNameDraft.trim()) {
      setEditingStageId(null)
      setStageNameDraft('')
      return
    }
    setBusy(true)
    try {
      await api('PATCH', `/api/pipeline/${activePipelineId}/stages/${stageId}`, {
        name: stageNameDraft.trim(),
      })
      updateActivePipeline((p) => ({
        ...p,
        stages: p.stages.map((s) =>
          s.id === stageId ? { ...s, name: stageNameDraft.trim() } : s,
        ),
      }))
      setEditingStageId(null)
      setStageNameDraft('')
    } finally {
      setBusy(false)
    }
  }

  function closeInlineEditors() {
    setEditingPipelineId(null)
    setPipelineNameDraft('')
    setEditingStageId(null)
    setStageNameDraft('')
    setOpenStageMenuId(null)
  }

  async function handleDeleteStage(stageId: string) {
    if (!activePipelineId) return
    setBusy(true)
    try {
      await api('DELETE', `/api/pipeline/${activePipelineId}/stages/${stageId}`)
      updateActivePipeline((p) => ({
        ...p,
        stages: p.stages.filter((s) => s.id !== stageId),
      }))
      if (isSales) {
        const affected = (pipelineLeads[activePipelineId] ?? []).filter(
          (l) => l.pipeline_stage_id === stageId,
        )
        if (affected.length) {
          setPipelineLeads((prev) => ({
            ...prev,
            [activePipelineId]: prev[activePipelineId].filter(
              (l) => l.pipeline_stage_id !== stageId,
            ),
          }))
          setUnassigned((prev) => [...affected.map((l) => ({ ...l, pipeline_stage_id: null })), ...prev])
        }
      } else {
        setPipelineItems((prev) => ({
          ...prev,
          [activePipelineId]: (prev[activePipelineId] ?? []).map((i) =>
            i.pipeline_stage_id === stageId ? { ...i, pipeline_stage_id: null } : i,
          ),
        }))
      }
      setConfirmDeleteStageId(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleMoveStage(stageId: string, direction: -1 | 1) {
    if (!activePipelineId || !activePipeline) return
    const stages = [...activePipeline.stages]
    const idx = stages.findIndex((s) => s.id === stageId)
    if (idx < 0) return
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= stages.length) return
    ;[stages[idx], stages[newIdx]] = [stages[newIdx], stages[idx]]
    const ordered = stages.map((s, i) => ({ ...s, position: i }))
    updateActivePipeline((p) => ({ ...p, stages: ordered }))
    await api('PATCH', `/api/pipeline/${activePipelineId}/stages`, {
      order: ordered.map((s) => s.id),
    }).catch(() => {
      updateActivePipeline((p) => ({ ...p, stages: activePipeline.stages }))
    })
  }

  async function handleChangeStageColor(stageId: string, color: string) {
    if (!activePipelineId) return
    updateActivePipeline((p) => ({
      ...p,
      stages: p.stages.map((s) => (s.id === stageId ? { ...s, color } : s)),
    }))
    await api('PATCH', `/api/pipeline/${activePipelineId}/stages/${stageId}`, { color }).catch(
      () => {
        updateActivePipeline((p) => ({
          ...p,
          stages: p.stages.map((s) => (s.id === stageId ? { ...s, color: STAGE_COLORS[0] } : s)),
        }))
      },
    )
  }

  // ── card actions ──────────────────────────────────────────────────────────

  async function handleMoveCard(
    card: Card,
    targetStageId: string | null,
    fromStageId: string | null,
  ) {
    if (!activePipelineId) return
    setBusy(true)
    try {
      if (card.source === 'lead') {
        await api('PATCH', '/api/pipeline/leads', {
          lead_id: card.id,
          pipeline_id: targetStageId ? activePipelineId : null,
          stage_id: targetStageId,
        })
        const lead: PipelineLead = {
          id: card.id,
          name: card.title,
          company: card.subtitle,
          status: card.statusKey,
          pipeline_stage_id: targetStageId,
          deal_value: card.value,
        }
        if (fromStageId === null) {
          setUnassigned((prev) => prev.filter((l) => l.id !== card.id))
          setPipelineLeads((prev) => ({
            ...prev,
            [activePipelineId]: [...(prev[activePipelineId] ?? []), lead],
          }))
        } else if (targetStageId === null) {
          setPipelineLeads((prev) => ({
            ...prev,
            [activePipelineId]: (prev[activePipelineId] ?? []).filter((l) => l.id !== card.id),
          }))
          setUnassigned((prev) => [lead, ...prev])
        } else {
          setPipelineLeads((prev) => ({
            ...prev,
            [activePipelineId]: (prev[activePipelineId] ?? []).map((l) =>
              l.id === card.id ? { ...l, pipeline_stage_id: targetStageId } : l,
            ),
          }))
        }
      } else {
        await api('PATCH', `/api/pipeline/${activePipelineId}/items/${card.id}`, {
          stage_id: targetStageId,
        })
        setPipelineItems((prev) => ({
          ...prev,
          [activePipelineId]: (prev[activePipelineId] ?? []).map((i) =>
            i.id === card.id ? { ...i, pipeline_stage_id: targetStageId } : i,
          ),
        }))
      }
      setMovingCardKey(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleAddCard(stageId: string | null) {
    if (!activePipelineId || !newCardTitle.trim() || isSales) return
    setBusy(true)
    try {
      const data = await api('POST', `/api/pipeline/${activePipelineId}/items`, {
        title: newCardTitle.trim(),
        subtitle: newCardSubtitle.trim() || null,
        pipeline_stage_id: stageId,
      })
      const item = data.item as PipelineItem
      setPipelineItems((prev) => ({
        ...prev,
        [activePipelineId]: [...(prev[activePipelineId] ?? []), item],
      }))
      setAddingCardStageId(null)
      setNewCardTitle('')
      setNewCardSubtitle('')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteCard(card: Card) {
    if (!activePipelineId || card.source !== 'item') return
    setBusy(true)
    try {
      await api('DELETE', `/api/pipeline/${activePipelineId}/items/${card.id}`)
      setPipelineItems((prev) => ({
        ...prev,
        [activePipelineId]: (prev[activePipelineId] ?? []).filter((i) => i.id !== card.id),
      }))
      setMovingCardKey(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleAddLead() {
    if (!activePipelineId || !isSales || !newLeadName.trim()) return
    setBusy(true)
    try {
      const parsedValue = newLeadValue.trim() ? Number(newLeadValue) : null
      const stageId = newLeadStageId || null
      const data = await api('POST', '/api/pipeline/leads', {
        name: newLeadName.trim(),
        company: newLeadCompany.trim() || null,
        status: newLeadStatus,
        deal_value: Number.isFinite(parsedValue) ? parsedValue : null,
        pipeline_id: stageId ? activePipelineId : null,
        stage_id: stageId,
      })
      const lead = data.lead as PipelineLead
      if (stageId) {
        setPipelineLeads((prev) => ({
          ...prev,
          [activePipelineId]: [lead, ...(prev[activePipelineId] ?? [])],
        }))
      } else {
        setUnassigned((prev) => [lead, ...prev])
      }
      setNewLeadName('')
      setNewLeadCompany('')
      setNewLeadValue('')
      setNewLeadStatus('warm')
      setNewLeadStageId('')
      setShowLeadForm(false)
    } finally {
      setBusy(false)
    }
  }

  // ── drag handlers ─────────────────────────────────────────────────────────

  function onDragStart(card: Card, fromStageId: string | null) {
    dragCardId.current = card.id
    dragCardSource.current = card.source
    dragStageId.current = fromStageId
  }

  function onDragOver(e: React.DragEvent, key: string | null) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStageKey(key ?? 'unassigned')
  }

  function onDragLeave() {
    setDragOverStageKey(null)
  }

  async function onDrop(e: React.DragEvent, targetStageId: string | null) {
    e.preventDefault()
    const cardId = dragCardId.current
    const cardSource = dragCardSource.current
    const fromStageId = dragStageId.current
    dragCardId.current = null
    dragCardSource.current = null
    dragStageId.current = null
    setDragOverStageKey(null)
    if (!cardId || !cardSource || fromStageId === targetStageId) return
    let card: Card | undefined
    if (cardSource === 'lead') {
      const found =
        fromStageId === null
          ? unassigned.find((l) => l.id === cardId)
          : (pipelineLeads[activePipelineId ?? ''] ?? []).find((l) => l.id === cardId)
      if (found) card = leadToCard(found)
    } else {
      const found = (pipelineItems[activePipelineId ?? ''] ?? []).find((i) => i.id === cardId)
      if (found) card = itemToCard(found)
    }
    if (!card) return
    await handleMoveCard(card, targetStageId, fromStageId)
  }

  // ── render: card ──────────────────────────────────────────────────────────

  function renderCard(card: Card, fromStageId: string | null) {
    const cardKey = `${card.source}:${card.id}`
    const dotColor = STATUS_DOT[card.statusKey] ?? '#94a3b8'
    const canOpenLead = card.source === 'lead'
    return (
      <div
        key={cardKey}
        draggable
        onDragStart={() => onDragStart(card, fromStageId)}
        onClick={() => {
          if (canOpenLead) router.push(`/dashboard/leads/${card.id}`)
        }}
        style={{
          background: '#fff',
          border: '1px solid var(--border-soft)',
          borderRadius: 10,
          padding: '14px 16px 12px',
          marginBottom: 8,
          cursor: canOpenLead ? 'pointer' : 'grab',
          position: 'relative',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        {/* title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: card.subtitle || card.value ? 4 : 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#0f0f0f', lineHeight: '1.35', flex: 1, minWidth: 0 }}>
            {card.source === 'lead' ? (
              <Link
                href={`/dashboard/leads/${card.id}`}
                style={{ color: 'inherit', textDecoration: 'none' }}
                draggable={false}
                onClick={(e) => e.stopPropagation()}
              >
                {card.title}
              </Link>
            ) : (
              card.title
            )}
          </div>
          {card.source === 'lead' && (
            <Link
              href={`/dashboard/leads/${card.id}`}
              draggable={false}
              onClick={(e) => e.stopPropagation()}
              title="Open lead"
              style={{ color: '#c4c9d4', flexShrink: 0, marginTop: 3, lineHeight: 1 }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1.5 9.5L9.5 1.5M9.5 1.5H3.5M9.5 1.5V7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          )}
        </div>

        {/* subtitle / company */}
        {card.subtitle && (
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: card.value ? 3 : 10 }}>
            {card.subtitle}
          </div>
        )}

        {/* value */}
        {card.value ? (
          <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600, marginBottom: 10 }}>
            {fmt(card.value)}
          </div>
        ) : null}

        {/* footer: status pill + move link */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: dotColor,
              background: dotColor + '1a',
              borderRadius: 999,
              padding: '2px 8px',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {statusLabel(card.statusKey)}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {canOpenLead && (
              <Link
                href={`/dashboard/leads/${card.id}`}
                draggable={false}
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontSize: 12,
                  color: 'var(--red, #ff2800)',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                Open lead
              </Link>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setMovingCardKey(movingCardKey === cardKey ? null : cardKey)
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 12,
                color: '#9ca3af',
                cursor: 'pointer',
                padding: 0,
                fontWeight: 500,
              }}
            >
              Move to...
            </button>
          </div>
        </div>
        {movingCardKey === cardKey && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              background: '#fff',
              border: '1px solid var(--border-soft)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-card-lg)',
              zIndex: 20,
              minWidth: 180,
              padding: 8,
            }}
          >
            <div style={{ fontSize: 11, color: '#6b7280', padding: '0 4px 6px', fontWeight: 600 }}>
              Move to
            </div>
            {activePipeline?.stages.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={busy || card.pipeline_stage_id === s.id}
                onClick={() => handleMoveCard(card, s.id, fromStageId)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  background: card.pipeline_stage_id === s.id ? '#f3f4f6' : 'none',
                  border: 'none',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: card.pipeline_stage_id === s.id ? 'default' : 'pointer',
                  color: '#0f0f0f',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: s.color,
                    marginRight: 6,
                  }}
                />
                {s.name}
                {card.pipeline_stage_id === s.id && (
                  <span style={{ color: '#6b7280', marginLeft: 4 }}>✓</span>
                )}
              </button>
            ))}
            {card.source === 'lead' && fromStageId !== null && (
              <>
                <div style={{ borderTop: '1px solid var(--border-soft)', margin: '4px 0' }} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleMoveCard(card, null, fromStageId)}
                  style={popoverDangerBtn}
                >
                  Unassign lead
                </button>
              </>
            )}
            {card.source === 'item' && (
              <>
                <div style={{ borderTop: '1px solid var(--border-soft)', margin: '4px 0' }} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDeleteCard(card)}
                  style={popoverDangerBtn}
                >
                  Remove card
                </button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── empty state ────────────────────────────────────────────────────────────

  if (pipelines.length === 0 && !creatingPipeline) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'calc(100vh - 80px)',
          gap: 16,
          padding: 24,
        }}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: '40px 48px',
            textAlign: 'center',
            maxWidth: 440,
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>
            Create your first board
          </h2>
          <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>
            Build a kanban for anything you track — sales pipelines, recruiting, team
            performance, projects, or whatever you make up. Drag, rename, recolor, and
            move cards from here or via Telegram.
          </p>
          <button
            type="button"
            onClick={() => setCreatingPipeline(true)}
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Create board
          </button>
        </div>
      </div>
    )
  }

  // ── create pipeline modal ──────────────────────────────────────────────────

  if (creatingPipeline) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'calc(100vh - 80px)',
          padding: 24,
        }}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: '32px 40px',
            minWidth: 420,
            maxWidth: 480,
            width: '100%',
          }}
        >
          <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>
            Create board
          </h2>

          <label style={fieldLabel}>Board type</label>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              marginBottom: 16,
            }}
          >
            {(Object.keys(KIND_LABEL) as PipelineKind[]).map((k) => {
              const meta = KIND_LABEL[k]
              const active = newPipelineKind === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setNewPipelineKind(k)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: active ? '2px solid var(--red)' : '1px solid #e5e7eb',
                    background: active ? '#fff5f4' : '#fff',
                    color: '#0f0f0f',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {meta.label}
                </button>
              )
            })}
          </div>

          <label style={fieldLabel}>Name</label>
          <input
            autoFocus
            value={newPipelineName}
            onChange={(e) => setNewPipelineName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreatePipeline()}
            placeholder={
              newPipelineKind === 'sales'
                ? 'e.g. Q2 Sales Pipeline'
                : newPipelineKind === 'recruiting'
                ? 'e.g. AE Hiring Funnel'
                : newPipelineKind === 'team'
                ? 'e.g. West Coast Team'
                : newPipelineKind === 'project'
                ? 'e.g. Q3 Launch'
                : 'e.g. My Board'
            }
            style={inputStyle}
          />

          <label style={{ ...fieldLabel, marginTop: 12 }}>Description (optional)</label>
          <input
            value={newPipelineDescription}
            onChange={(e) => setNewPipelineDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreatePipeline()}
            placeholder="One-liner shown in the dashboard"
            style={inputStyle}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              disabled={busy || !newPipelineName.trim()}
              onClick={handleCreatePipeline}
              style={{
                flex: 1,
                background: 'var(--red)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px',
                fontSize: 14,
                fontWeight: 600,
                cursor: busy || !newPipelineName.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !newPipelineName.trim() ? 0.6 : 1,
              }}
            >
              {busy ? 'Creating…' : 'Create board'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatingPipeline(false)
                setNewPipelineName('')
                setNewPipelineDescription('')
                setNewPipelineKind('sales')
              }}
              style={{
                flex: 1,
                background: '#f3f4f6',
                color: '#374151',
                border: 'none',
                borderRadius: 8,
                padding: '10px',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── main kanban view ───────────────────────────────────────────────────────

  return (
    <div
      onClick={() => {
        setMovingCardKey(null)
        closeInlineEditors()
      }}
      style={{ userSelect: 'none' }}
    >
      {/* pipeline tabs */}
      <div
        style={{
          padding: '14px 20px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        {pipelines.map((p) => {
          const meta = KIND_LABEL[p.kind] ?? KIND_LABEL.custom
          const active = activePipelineId === p.id
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {editingPipelineId === p.id ? (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <input
                    autoFocus
                    value={pipelineNameDraft}
                    onBlur={() => {
                      setEditingPipelineId(null)
                      setPipelineNameDraft('')
                    }}
                    onChange={(e) => setPipelineNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenamePipeline(p.id)
                      if (e.key === 'Escape') {
                        setEditingPipelineId(null)
                        setPipelineNameDraft('')
                      }
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-soft)',
                      fontSize: 13,
                      fontWeight: 600,
                      width: 160,
                    }}
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleRenamePipeline(p.id)}
                    style={textActionBtn}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setEditingPipelineId(null)
                      setPipelineNameDraft('')
                    }}
                    style={textActionBtnMuted}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setActivePipelineId(p.id)}
                  title={p.description ?? meta.label}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.3)',
                    background: active ? '#fff' : 'rgba(255,255,255,0.15)',
                    color: active ? '#0f0f0f' : '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.01em',
                    cursor: 'pointer',
                  }}
                >
                  {p.name}
                </button>
              )}
              {active && editingPipelineId !== p.id && (
                <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => setOpenPipelineMenuId(openPipelineMenuId === p.id ? null : p.id)}
                    title="Board options"
                    aria-label="Board options"
                    style={{
                      background: 'none',
                      border: 'none',
                      borderRadius: 6,
                      color: 'rgba(255,255,255,0.85)',
                      fontSize: 18,
                      fontWeight: 700,
                      lineHeight: 1,
                      padding: '4px 7px',
                      cursor: 'pointer',
                    }}
                  >
                    ⋮
                  </button>
                  {openPipelineMenuId === p.id && (
                    <div style={stageMenuDropdown}>
                      <button
                        type="button"
                        onClick={() => {
                          setPipelineNameDraft(p.name)
                          setEditingPipelineId(p.id)
                          setOpenPipelineMenuId(null)
                        }}
                        style={stageMenuItemBtn}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeletePipelineId(p.id)
                          setOpenPipelineMenuId(null)
                        }}
                        style={{ ...stageMenuItemBtn, color: '#ef4444' }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => setCreatingPipeline(true)}
          style={{
            padding: '6px 12px',
            borderRadius: 999,
            border: '1px dashed rgba(255,255,255,0.5)',
            background: 'none',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Add board
        </button>
      </div>

      {activePipeline?.description && (
        <div style={{ padding: '8px 20px 0', color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
          {activePipeline.description}
        </div>
      )}

      {activePipeline && (
        <div style={{ padding: '12px 20px 0', display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
          {isSales && (
            <button
              type="button"
              onClick={() => {
                setShowLeadForm((v) => !v)
                setAddingCardStageId(null)
              }}
              style={panelActionBtn}
            >
              {showLeadForm ? 'Hide lead form' : '+ Add lead'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setAddingStage((v) => !v)
              if (!addingStage) setNewStageName('')
            }}
            style={panelActionBtnGhost}
          >
            {addingStage ? 'Hide stage form' : '+ Add stage'}
          </button>
        </div>
      )}

      {activePipeline && isSales && showLeadForm && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            margin: '10px 20px 0',
            background: '#fff',
            border: '1px solid var(--border-soft)',
            borderRadius: 12,
            padding: 10,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <input
            autoFocus
            value={newLeadName}
            onChange={(e) => setNewLeadName(e.target.value)}
            placeholder="Lead name"
            style={smallInput}
          />
          <input
            value={newLeadCompany}
            onChange={(e) => setNewLeadCompany(e.target.value)}
            placeholder="Company"
            style={smallInput}
          />
          <input
            value={newLeadValue}
            onChange={(e) => setNewLeadValue(e.target.value)}
            placeholder="Value"
            inputMode="decimal"
            style={smallInput}
          />
          <select
            value={newLeadStatus}
            onChange={(e) => setNewLeadStatus(e.target.value)}
            style={smallInput}
          >
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
            <option value="dormant">Dormant</option>
          </select>
          <select
            value={newLeadStageId}
            onChange={(e) => setNewLeadStageId(e.target.value)}
            style={smallInput}
          >
            <option value="">Unassigned</option>
            {activePipeline.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>{stage.name}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !newLeadName.trim()}
            onClick={handleAddLead}
            style={primarySmallBtn}
          >
            {busy ? 'Adding...' : 'Add lead'}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowLeadForm(false)
              setNewLeadName('')
              setNewLeadCompany('')
              setNewLeadValue('')
              setNewLeadStatus('warm')
              setNewLeadStageId('')
            }}
            style={secondarySmallBtn}
          >
            Cancel
          </button>
        </div>
      )}

      {activePipeline && (
        <div
          style={{
            overflowX: 'auto',
            padding: '14px 20px 28px',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            minHeight: 'calc(100vh - 160px)',
          }}
        >
          {isSales && (
            <div
              onDragOver={(e) => onDragOver(e, null)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, null)}
              style={{
                ...columnStyle,
                borderTop: '4px solid #ff7a59',
                ...(dragOverStageKey === 'unassigned' ? columnDragOverStyle : {}),
              }}
            >
              <div style={columnHeaderStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1 }}>
                  <span style={stageNameStyle}>Unassigned</span>
                  <span style={countBadge}>{unassigned.length}</span>
                </div>
              </div>
              <div style={columnBodyStyle}>
                {unassigned.map((lead) => renderCard(leadToCard(lead), null))}
                <div style={dropTargetStyle(unassigned.length === 0, dragOverStageKey === 'unassigned')}>
                  {unassigned.length === 0 ? 'Drop leads here to unassign' : 'Drop card here'}
                </div>
              </div>
            </div>
          )}

          {activePipeline.stages.map((stage, idx) => {
            const stageCards = activeCards.filter((c) => c.pipeline_stage_id === stage.id)
            const isDragOver = dragOverStageKey === stage.id
            return (
              <div
                key={stage.id}
                onDragOver={(e) => onDragOver(e, stage.id)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, stage.id)}
                style={{ ...columnStyle, ...(isDragOver ? columnDragOverStyle : {}), borderTop: `4px solid ${stage.color}` }}
              >
                <div style={columnHeaderStyle}>
                  {editingStageId === stage.id ? (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}
                    >
                      <input
                        autoFocus
                        value={stageNameDraft}
                        onBlur={() => {
                          setEditingStageId(null)
                          setStageNameDraft('')
                        }}
                        onChange={(e) => setStageNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameStage(stage.id)
                          if (e.key === 'Escape') {
                            setEditingStageId(null)
                            setStageNameDraft('')
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: '3px 7px',
                          borderRadius: 4,
                          border: '1px solid var(--border-soft)',
                          fontSize: 12,
                          fontWeight: 700,
                          minWidth: 0,
                        }}
                      />
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleRenameStage(stage.id)}
                        style={textActionBtn}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setEditingStageId(null)
                          setStageNameDraft('')
                        }}
                        style={textActionBtnMuted}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: stage.color,
                            flexShrink: 0,
                          }}
                        />
                        <span style={stageNameStyle}>{stage.name}</span>
                        <span style={{ ...countBadge, background: `${stage.color}1f`, color: stage.color }}>{stageCards.length}</span>
                      </div>
                      <div style={{ position: 'relative', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setOpenStageMenuId(openStageMenuId === stage.id ? null : stage.id)}
                          style={stageMenuBtn}
                          title="Stage options"
                          aria-label="Stage options"
                        >
                          ⋮
                        </button>
                        {openStageMenuId === stage.id && (
                          <div style={stageMenuDropdown}>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => { handleMoveStage(stage.id, -1); setOpenStageMenuId(null) }}
                              style={{ ...stageMenuItemBtn, opacity: idx === 0 ? 0.4 : 1 }}
                            >
                              Move left
                            </button>
                            <button
                              type="button"
                              disabled={idx === activePipeline.stages.length - 1}
                              onClick={() => { handleMoveStage(stage.id, 1); setOpenStageMenuId(null) }}
                              style={{ ...stageMenuItemBtn, opacity: idx === activePipeline.stages.length - 1 ? 0.4 : 1 }}
                            >
                              Move right
                            </button>
                            <div style={{ display: 'flex', gap: 4, padding: '5px 10px', flexWrap: 'wrap' }}>
                              {STAGE_COLORS.map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => { handleChangeStageColor(stage.id, c); setOpenStageMenuId(null) }}
                                  style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: '50%',
                                    background: c,
                                    border: stage.color === c ? '2px solid #0f0f0f' : '2px solid transparent',
                                    cursor: 'pointer',
                                    padding: 0,
                                  }}
                                />
                              ))}
                            </div>
                            <div style={{ borderTop: '1px solid var(--border-soft)', margin: '4px 0' }} />
                            <button
                              type="button"
                              onClick={() => { setStageNameDraft(stage.name); setEditingStageId(stage.id); setOpenStageMenuId(null) }}
                              style={stageMenuItemBtn}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => { setConfirmDeleteStageId(stage.id); setOpenStageMenuId(null) }}
                              style={{ ...stageMenuItemBtn, color: '#ef4444' }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div style={columnBodyStyle}>
                  {stageCards.map((card) => renderCard(card, stage.id))}

                  <div style={dropTargetStyle(stageCards.length === 0, isDragOver)}>
                    {stageCards.length === 0
                      ? `Drop ${KIND_LABEL[activeKind].cardNoun}s here`
                      : 'Drop card here'}
                  </div>

                  {!isSales && (
                    addingCardStageId === stage.id ? (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          background: '#fff',
                          border: '1px solid var(--border-soft)',
                          borderRadius: 8,
                          padding: 10,
                          marginTop: 6,
                        }}
                      >
                        <input
                          autoFocus
                          value={newCardTitle}
                          onChange={(e) => setNewCardTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newCardTitle.trim()) handleAddCard(stage.id)
                            if (e.key === 'Escape') {
                              setAddingCardStageId(null)
                              setNewCardTitle('')
                              setNewCardSubtitle('')
                            }
                          }}
                          placeholder="Title"
                          style={smallInput}
                        />
                        <input
                          value={newCardSubtitle}
                          onChange={(e) => setNewCardSubtitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newCardTitle.trim()) handleAddCard(stage.id)
                          }}
                          placeholder="Subtitle (optional)"
                          style={{ ...smallInput, marginTop: 6 }}
                        />
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <button
                            type="button"
                            disabled={busy || !newCardTitle.trim()}
                            onClick={() => handleAddCard(stage.id)}
                            style={primarySmallBtn}
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddingCardStageId(null)
                              setNewCardTitle('')
                              setNewCardSubtitle('')
                            }}
                            style={secondarySmallBtn}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setAddingCardStageId(stage.id)
                          setNewCardTitle('')
                          setNewCardSubtitle('')
                        }}
                        style={{
                          width: '100%',
                          marginTop: 4,
                          padding: '6px 8px',
                          background: 'none',
                          border: '1px dashed #cbd5e1',
                          borderRadius: 6,
                          fontSize: 12,
                          color: '#64748b',
                          cursor: 'pointer',
                        }}
                      >
                        Add {KIND_LABEL[activeKind].cardNoun}
                      </button>
                    )
                  )}
                </div>
              </div>
            )
          })}

          <div style={{ ...columnStyle, minWidth: 220, maxWidth: 220, border: '1px dashed #d1d5db', background: 'transparent', opacity: 0.85, padding: 10 }}>
            {addingStage ? (
              <>
                <input
                  autoFocus
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddStage()
                    if (e.key === 'Escape') {
                      setAddingStage(false)
                      setNewStageName('')
                    }
                  }}
                  placeholder="Stage name"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border-soft)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                    marginBottom: 8,
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleAddStage}
                    style={primarySmallBtn}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingStage(false)
                      setNewStageName('')
                    }}
                    style={secondarySmallBtn}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setAddingStage(true)}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'none',
                  border: 'none',
                  borderRadius: 10,
                  color: '#9ca3af',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                + Add stage
              </button>
            )}
          </div>
        </div>
      )}

      {confirmDeletePipelineId && (
        <Modal
          title="Delete board"
          message={
            isSales
              ? 'All leads will be unassigned from this pipeline. This cannot be undone.'
              : 'All cards on this board will be deleted. This cannot be undone.'
          }
          confirmLabel="Delete board"
          onConfirm={() => handleDeletePipeline(confirmDeletePipelineId)}
          onCancel={() => setConfirmDeletePipelineId(null)}
          busy={busy}
          danger
        />
      )}

      {confirmDeleteStageId && (
        <Modal
          title="Delete stage"
          message={
            isSales
              ? 'Leads in this stage will be moved to Unassigned.'
              : 'Cards in this stage will lose their stage assignment but remain on the board.'
          }
          confirmLabel="Delete stage"
          onConfirm={() => handleDeleteStage(confirmDeleteStageId)}
          onCancel={() => setConfirmDeleteStageId(null)}
          busy={busy}
          danger
        />
      )}
    </div>
  )
}

// ── shared style tokens ───────────────────────────────────────────────────────

const columnStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  border: '1px solid var(--border-soft)',
  minWidth: 'clamp(240px, 28vw, 280px)',
  maxWidth: 'clamp(252px, 30vw, 292px)',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 'calc(100vh - 190px)',
  overflow: 'hidden',
  transition: 'border-color 120ms ease',
}

const columnDragOverStyle: React.CSSProperties = {
  borderColor: 'var(--red, #ff2800)',
  boxShadow: '0 0 0 2px rgba(255,40,0,0.12)',
}

const columnHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '12px 14px 10px',
  borderBottom: '1px solid var(--border-soft)',
  position: 'sticky',
  top: 0,
  background: '#fff',
  zIndex: 1,
}

const columnBodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '10px 10px 6px',
  minHeight: 80,
}

const stageNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--ink, #0f0f0f)',
  letterSpacing: '-0.005em',
  flex: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const countBadge: React.CSSProperties = {
  background: 'rgba(255,40,0,0.12)',
  color: 'var(--red, #ff2800)',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  padding: '1px 5px',
  flexShrink: 0,
}

function dropTargetStyle(isEmpty: boolean, isOver: boolean): React.CSSProperties {
  return {
    textAlign: 'center',
    color: isOver ? 'var(--red, #ff2800)' : '#9ca3af',
    fontSize: 12,
    margin: isEmpty ? '20px 0' : '6px 0',
    padding: isEmpty ? '24px 8px' : '10px 8px',
    border: `2px dashed ${isOver ? 'var(--red, #ff2800)' : isEmpty ? '#cbd5e1' : 'transparent'}`,
    borderRadius: 8,
    background: isOver ? '#fff5f4' : 'transparent',
    transition: 'all 120ms ease',
    fontWeight: isOver ? 600 : 400,
    pointerEvents: 'none',
  }
}

const panelActionBtn: React.CSSProperties = {
  background: 'var(--ink, #0f0f0f)',
  border: '1px solid var(--ink, #0f0f0f)',
  color: '#fff',
  borderRadius: 999,
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  letterSpacing: '0.01em',
}

const panelActionBtnGhost: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.45)',
  color: '#fff',
  borderRadius: 999,
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  letterSpacing: '0.01em',
}

const stageMenuBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  borderRadius: 6,
  color: '#9ca3af',
  fontSize: 18,
  fontWeight: 700,
  lineHeight: 1,
  padding: '4px 7px',
  cursor: 'pointer',
  letterSpacing: '0.04em',
  transition: 'background-color 120ms, color 120ms',
}

const stageMenuDropdown: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  background: '#fff',
  border: '1px solid var(--border-soft)',
  borderRadius: 8,
  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
  zIndex: 30,
  minWidth: 148,
  padding: '4px 0',
}

const stageMenuItemBtn: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '7px 14px',
  background: 'none',
  border: 'none',
  fontSize: 13,
  color: '#1f2937',
  cursor: 'pointer',
}

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-soft)',
  fontSize: 14,
  boxSizing: 'border-box',
}

const smallInput: React.CSSProperties = {
  width: '100%',
  padding: '6px 7px',
  borderRadius: 6,
  border: '1px solid var(--border-soft)',
  fontSize: 12,
  boxSizing: 'border-box',
}

const primarySmallBtn: React.CSSProperties = {
  flex: 1,
  background: 'var(--red)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
}

const secondarySmallBtn: React.CSSProperties = {
  flex: 1,
  background: '#f3f4f6',
  color: '#374151',
  border: 'none',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 11,
  cursor: 'pointer',
}

const popoverDangerBtn: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 8px',
  background: 'none',
  border: 'none',
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
  color: '#ef4444',
}

const textActionBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border-soft)',
  borderRadius: 4,
  color: '#111827',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 6px',
  cursor: 'pointer',
}

const textActionBtnMuted: React.CSSProperties = {
  ...textActionBtn,
  color: 'var(--red, #ff2800)',
}

// ── simple modal ──────────────────────────────────────────────────────────────

function Modal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  danger,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
  danger?: boolean
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: '28px 32px',
          maxWidth: 400,
          width: '100%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 700 }}>{title}</h3>
        <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            style={{
              flex: 1,
              background: danger ? '#ef4444' : 'var(--red)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px',
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1,
              background: '#f3f4f6',
              color: '#374151',
              border: 'none',
              borderRadius: 8,
              padding: '10px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
