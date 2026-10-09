'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '@/app/components/PageHeader'
import {
  CARD_STAGES,
  CARD_URGENCY,
  initialsFor,
  stageLabel,
  urgencyLabel,
  type Board,
  type BoardCard,
  type BoardList,
  type BoardPerson,
  type CardAssignee,
  type CardUrgency,
  type ChecklistItem,
} from '@/lib/boardsShared'
import { parseBoardFile } from './importBoard'

type Contents = { lists: BoardList[]; cards: BoardCard[]; assignees: CardAssignee[]; checklist: ChecklistItem[] }
const EMPTY: Contents = { lists: [], cards: [], assignees: [], checklist: [] }

async function api<T = { ok: true }>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error || 'That did not save.')
  return json as T
}

const keyOf = (a: CardAssignee) => (a.member_id ? `m:${a.member_id}` : `p:${a.partner_id}`)

function dueText(d: string | null): string | null {
  if (!d) return null
  const dt = new Date(d + 'T12:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function BoardsClient() {
  const [boards, setBoards] = useState<Board[]>([])
  const [people, setPeople] = useState<BoardPerson[]>([])
  const [me, setMe] = useState<string>('')
  const [boardId, setBoardId] = useState<string | null>(null)
  const [c, setC] = useState<Contents>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [notReady, setNotReady] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [mine, setMine] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadBoards = useCallback(async (pick?: string) => {
    const res = await fetch('/api/boards', { cache: 'no-store' })
    const j = (await res.json().catch(() => ({}))) as { boards?: Board[]; people?: BoardPerson[]; me?: string; notReady?: boolean; error?: string }
    setBoards(j.boards ?? [])
    setPeople(j.people ?? [])
    setMe(j.me ?? '')
    setNotReady(!!j.notReady)
    if (j.error) setMsg(j.error)
    let next = pick ?? null
    if (!next && typeof window !== 'undefined') next = new URLSearchParams(window.location.search).get('board')
    try {
      if (!next) next = localStorage.getItem('cxo-board') || null
    } catch {}
    if (!next || !(j.boards ?? []).some((b) => b.id === next)) next = j.boards?.[0]?.id ?? null
    setBoardId(next)
    setLoading(false)
  }, [])

  const loadContents = useCallback(async (id: string) => {
    const res = await fetch(`/api/boards?board=${encodeURIComponent(id)}`, { cache: 'no-store' })
    const j = (await res.json().catch(() => ({}))) as Partial<Contents> & { error?: string }
    if (j.error) setMsg(j.error)
    setC({ lists: j.lists ?? [], cards: j.cards ?? [], assignees: j.assignees ?? [], checklist: j.checklist ?? [] })
  }, [])

  useEffect(() => {
    loadBoards()
  }, [loadBoards])
  useEffect(() => {
    if (!boardId) {
      setC(EMPTY)
      return
    }
    try {
      localStorage.setItem('cxo-board', boardId)
    } catch {}
    loadContents(boardId)
  }, [boardId, loadContents])

  const run = async (fn: () => Promise<unknown>, reload = true) => {
    try {
      setMsg(null)
      await fn()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'That did not save.')
    }
    if (reload && boardId) await loadContents(boardId)
  }

  const board = boards.find((b) => b.id === boardId) ?? null
  const peopleByKey = useMemo(() => new Map(people.map((p) => [p.key, p])), [people])
  const assigneesOf = useCallback((cardId: string) => c.assignees.filter((a) => a.card_id === cardId).map(keyOf), [c.assignees])
  const visibleCards = useCallback(
    (listId: string) =>
      c.cards
        .filter((x) => x.list_id === listId)
        .filter((x) => !mine || assigneesOf(x.id).includes(`m:${me}`))
        .sort((a, b) => a.position - b.position),
    [c.cards, mine, me, assigneesOf],
  )

  // ── Boards ────────────────────────────────────────────────────────────────
  const newBoard = async () => {
    const name = window.prompt('Name the board')
    if (!name?.trim()) return
    try {
      const { board: b } = await api<{ board: Board }>({ op: 'board.create', name })
      await loadBoards(b.id)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not make the board.')
    }
  }
  const renameBoard = async () => {
    if (!board) return
    const name = window.prompt('Rename the board', board.name)
    if (!name?.trim() || name === board.name) return
    await run(() => api({ op: 'board.rename', id: board.id, name }), false)
    await loadBoards(board.id)
  }
  const deleteBoard = async () => {
    if (!board) return
    if (!window.confirm(`Delete "${board.name}" and every card on it?`)) return
    await run(() => api({ op: 'board.delete', id: board.id }), false)
    await loadBoards()
  }
  const onImportFile = async (file: File) => {
    setImporting(true)
    setMsg(null)
    try {
      const text = await file.text()
      const payload = parseBoardFile(file.name, text)
      const res = await api<{ board: Board; cards: number }>({ op: 'board.import', payload })
      await loadBoards(res.board.id)
      setMsg(`Imported "${res.board.name}": ${payload.lists.length} lists, ${res.cards} cards.`)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'That file could not be read.')
    }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Drag and drop (native HTML5, as in crmbuilds) ───────────────────────────
  const drag = useRef<{ kind: 'card' | 'list'; id: string } | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const dropCard = async (listId: string, beforeCardId: string | null) => {
    const d = drag.current
    drag.current = null
    setOver(null)
    if (!d || d.kind !== 'card') return
    const moving = c.cards.find((x) => x.id === d.id)
    if (!moving) return
    const target = c.cards.filter((x) => x.list_id === listId && x.id !== d.id).sort((a, b) => a.position - b.position)
    const at = beforeCardId ? Math.max(0, target.findIndex((x) => x.id === beforeCardId)) : target.length
    target.splice(at, 0, { ...moving, list_id: listId })
    const ids = target.map((x) => x.id)
    // Optimistic: move it now, save behind.
    setC((prev) => ({
      ...prev,
      cards: prev.cards.map((x) => {
        const i = ids.indexOf(x.id)
        return i >= 0 ? { ...x, list_id: listId, position: i } : x
      }),
    }))
    await run(() => api({ op: 'card.place', listId, ids }))
  }
  const dropList = async (beforeListId: string) => {
    const d = drag.current
    drag.current = null
    setOver(null)
    if (!d || d.kind !== 'list' || d.id === beforeListId) return
    const order = c.lists.filter((l) => l.id !== d.id).sort((a, b) => a.position - b.position)
    const at = order.findIndex((l) => l.id === beforeListId)
    const moving = c.lists.find((l) => l.id === d.id)!
    order.splice(at < 0 ? order.length : at, 0, moving)
    setC((prev) => ({ ...prev, lists: order.map((l, i) => ({ ...l, position: i })) }))
    await run(() => api({ op: 'list.order', ids: order.map((l) => l.id) }))
  }

  const editingCard = c.cards.find((x) => x.id === editing) ?? null
  const lists = [...c.lists].sort((a, b) => a.position - b.position)

  return (
    <main className="wrap cx-boards-page">
      <PageHeader
        eyebrow="Boards"
        title={board?.name ?? 'Boards'}
        actions={
          <>
            <button type="button" className="cx-btn" onClick={newBoard}>+ New board</button>
            <button type="button" className="cx-btn cx-btn-ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : 'Import a board'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              hidden
              onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])}
            />
          </>
        }
      />

      {notReady && <p className="cx-notice">Boards are being set up on this account. Try again in a minute.</p>}
      {msg && <p className="cx-notice" role="status">{msg}</p>}

      {!loading && boards.length === 0 && !notReady && (
        <section className="cx-panel cx-board-empty">
          <h2>No boards yet</h2>
          <p>Make a board for a project, a launch or a deal, or bring one in from a board export (JSON) or a spreadsheet (CSV with list, title, notes, due).</p>
          <p className="cx-board-empty-actions">
            <button type="button" className="cx-btn" onClick={newBoard}>+ New board</button>
            <button type="button" className="cx-btn cx-btn-ghost" onClick={() => fileRef.current?.click()}>Import a board</button>
          </p>
        </section>
      )}

      {boards.length > 0 && (
        <div className="cx-board-bar">
          <div className="cx-board-tabs" role="tablist" aria-label="Boards">
            {boards.map((b) => (
              <button key={b.id} type="button" role="tab" aria-selected={b.id === boardId} className={b.id === boardId ? 'is-on' : ''} onClick={() => setBoardId(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
          <div className="cx-board-tools">
            <div className="cx-board-seg" role="group" aria-label="Show">
              <button type="button" className={!mine ? 'is-on' : ''} onClick={() => setMine(false)}>All cards</button>
              <button type="button" className={mine ? 'is-on' : ''} onClick={() => setMine(true)}>Mine</button>
            </div>
            {board && (
              <details className="cx-menu">
                <summary className="cx-btn cx-btn-ghost cx-btn-sm">Board ▾</summary>
                <div className="cx-menu-body cx-board-menu">
                  <button type="button" onClick={renameBoard}>Rename board</button>
                  <button type="button" className="is-danger" onClick={deleteBoard}>Delete board</button>
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {board && (
        <div className="cx-board-cols">
          {lists.map((l) => {
            const cards = visibleCards(l.id)
            return (
              <section
                key={l.id}
                className={`cx-board-col${over === l.id ? ' is-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (over !== l.id) setOver(l.id)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (drag.current?.kind === 'list') dropList(l.id)
                  else dropCard(l.id, null)
                }}
              >
                <header
                  className="cx-board-col-head"
                  draggable
                  onDragStart={(e) => {
                    drag.current = { kind: 'list', id: l.id }
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                >
                  <ListTitle list={l} onSave={(title) => run(() => api({ op: 'list.rename', id: l.id, title }))} />
                  <span className="cx-board-count">{cards.length}</span>
                  <button
                    type="button"
                    className="cx-board-x"
                    aria-label={`Delete list ${l.title}`}
                    onClick={() => {
                      const n = c.cards.filter((x) => x.list_id === l.id).length
                      if (n && !window.confirm(`Delete "${l.title}" and its ${n} card${n === 1 ? '' : 's'}?`)) return
                      run(() => api({ op: 'list.delete', id: l.id }))
                    }}
                  >
                    ×
                  </button>
                </header>
                <div className="cx-board-cards">
                  {cards.map((card) => (
                    <CardTile
                      key={card.id}
                      card={card}
                      people={assigneesOf(card.id).map((k) => peopleByKey.get(k)).filter(Boolean) as BoardPerson[]}
                      checklist={c.checklist.filter((i) => i.card_id === card.id)}
                      onOpen={() => setEditing(card.id)}
                      onDragStart={() => (drag.current = { kind: 'card', id: card.id })}
                      onDropBefore={() => dropCard(l.id, card.id)}
                    />
                  ))}
                </div>
                <AddCard onAdd={(title) => run(() => api({ op: 'card.create', boardId: board.id, listId: l.id, title }))} />
              </section>
            )
          })}
          <AddList onAdd={(title) => run(() => api({ op: 'list.create', boardId: board.id, title }))} />
        </div>
      )}

      {editingCard && (
        <CardEditor
          card={editingCard}
          people={people}
          assigned={assigneesOf(editingCard.id)}
          checklist={c.checklist.filter((i) => i.card_id === editingCard.id).sort((a, b) => a.position - b.position)}
          onClose={() => setEditing(null)}
          run={run}
          setMsg={setMsg}
        />
      )}
    </main>
  )
}

function ListTitle({ list, onSave }: { list: BoardList; onSave: (t: string) => void }) {
  const [v, setV] = useState(list.title)
  useEffect(() => setV(list.title), [list.title])
  return (
    <input
      className="cx-board-col-title"
      value={v}
      aria-label="List name"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v !== list.title && onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function CardTile({
  card,
  people,
  checklist,
  onOpen,
  onDragStart,
  onDropBefore,
}: {
  card: BoardCard
  people: BoardPerson[]
  checklist: ChecklistItem[]
  onOpen: () => void
  onDragStart: () => void
  onDropBefore: () => void
}) {
  const stage = stageLabel(card.label_color)
  const due = dueText(card.due_date)
  const urg = urgencyLabel(card.urgency)
  const done = checklist.filter((i) => i.done).length
  return (
    <article
      className={`cx-board-card${card.done_at ? ' is-done' : ''}`}
      draggable
      onDragStart={(e) => {
        e.stopPropagation()
        onDragStart()
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDropBefore()
      }}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      tabIndex={0}
      role="button"
    >
      {stage && (
        <p className="cx-board-stage">
          <i style={{ background: card.label_color ?? undefined }} />
          {stage}
        </p>
      )}
      <p className="cx-board-card-title">{card.title}</p>
      {(due || urg || checklist.length > 0 || people.length > 0 || card.tags.length > 0) && (
        <div className="cx-board-card-meta">
          {urg && <span className={card.urgency === 'now' ? 'is-now' : ''}>{urg}</span>}
          {due && <span>Due {due}</span>}
          {checklist.length > 0 && <span>{done}/{checklist.length}</span>}
          {card.tags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
          {people.length > 0 && (
            <span className="cx-board-people">
              {people.slice(0, 4).map((p) => (
                <b key={p.key} title={p.kind === 'partner' ? `${p.name}${p.org ? `, ${p.org}` : ''} (partner)` : p.name} className={p.kind === 'partner' ? 'is-partner' : ''}>
                  {initialsFor(p.name)}
                </b>
              ))}
            </span>
          )}
        </div>
      )}
    </article>
  )
}

function AddCard({ onAdd }: { onAdd: (t: string) => Promise<void> | void }) {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState('')
  if (!open)
    return (
      <button type="button" className="cx-board-add" onClick={() => setOpen(true)}>
        + Add a card
      </button>
    )
  const submit = async () => {
    if (v.trim()) await onAdd(v.trim())
    setV('')
  }
  return (
    <div className="cx-board-addform">
      <textarea
        autoFocus
        rows={2}
        value={v}
        placeholder="What needs doing?"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      <p>
        <button type="button" className="cx-btn cx-btn-sm" onClick={submit}>Add card</button>
        <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setOpen(false)}>Done</button>
      </p>
    </div>
  )
}

function AddList({ onAdd }: { onAdd: (t: string) => Promise<void> | void }) {
  const [v, setV] = useState('')
  return (
    <form
      className="cx-board-col cx-board-newcol"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!v.trim()) return
        await onAdd(v.trim())
        setV('')
      }}
    >
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="+ Add a list" aria-label="New list name" />
      {v.trim() && <button type="submit" className="cx-btn cx-btn-sm">Add list</button>}
    </form>
  )
}

function CardEditor({
  card,
  people,
  assigned,
  checklist,
  onClose,
  run,
  setMsg,
}: {
  card: BoardCard
  people: BoardPerson[]
  assigned: string[]
  checklist: ChecklistItem[]
  onClose: () => void
  run: (fn: () => Promise<unknown>, reload?: boolean) => Promise<void>
  setMsg: (m: string | null) => void
}) {
  const [title, setTitle] = useState(card.title)
  const [notes, setNotes] = useState(card.notes ?? '')
  const [tags, setTags] = useState(card.tags.join(', '))
  const [newItem, setNewItem] = useState('')
  const [who, setWho] = useState<string[]>(assigned)
  const [savingWho, setSavingWho] = useState(false)
  const [whoNote, setWhoNote] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = (p: Record<string, unknown>) => run(() => api({ op: 'card.update', id: card.id, patch: p }))
  const saveText = () => {
    const p: Record<string, unknown> = {}
    if (title.trim() && title !== card.title) p.title = title
    if (notes !== (card.notes ?? '')) p.notes = notes
    const t = tags.split(',').map((x) => x.trim()).filter(Boolean)
    if (t.join(',') !== card.tags.join(',')) p.tags = t
    if (Object.keys(p).length) patch(p)
  }

  const members = people.filter((p) => p.kind === 'member')
  const partners = people.filter((p) => p.kind === 'partner')
  const whoChanged = who.slice().sort().join() !== assigned.slice().sort().join()

  const saveWho = async () => {
    setSavingWho(true)
    setWhoNote(null)
    try {
      const r = await api<{ notified: string[]; notNotified: Array<{ name: string; reason: string }> }>({ op: 'card.assign', id: card.id, keys: who })
      const parts: string[] = []
      if (r.notified.length) parts.push(`Emailed ${r.notified.join(', ')}.`)
      for (const n of r.notNotified) parts.push(`${n.name} was not emailed: ${n.reason}`)
      setWhoNote(parts.join(' ') || 'Saved.')
    } catch (err) {
      setWhoNote(err instanceof Error ? err.message : 'That did not save.')
    }
    setSavingWho(false)
    await run(async () => {})
  }

  const toggle = (k: string) => setWho((w) => (w.includes(k) ? w.filter((x) => x !== k) : [...w, k]))

  return (
    <div className="cx-board-modal" role="dialog" aria-modal="true" aria-label="Card" onMouseDown={(e) => e.target === e.currentTarget && (saveText(), onClose())}>
      <div className="cx-board-editor">
        <header>
          <input className="cx-board-editor-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveText} aria-label="Card title" />
          <button type="button" className="cx-board-x" aria-label="Close" onClick={() => { saveText(); onClose() }}>×</button>
        </header>

        <div className="cx-board-editor-grid">
          <label>
            Stage
            <select value={card.label_color ?? ''} onChange={(e) => patch({ label_color: e.target.value || null })}>
              <option value="">No stage</option>
              {CARD_STAGES.map((s) => (
                <option key={s.color} value={s.color}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>
            When
            <select value={card.urgency ?? ''} onChange={(e) => patch({ urgency: (e.target.value || null) as CardUrgency | null })}>
              <option value="">Not set</option>
              {CARD_URGENCY.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </label>
          <label>
            Due
            <input type="date" value={card.due_date ?? ''} onChange={(e) => patch({ due_date: e.target.value || null })} />
          </label>
        </div>

        <label className="cx-board-field">
          Notes
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveText} placeholder="Context, links, what done looks like" />
        </label>
        <label className="cx-board-field">
          Tags
          <input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={saveText} placeholder="carrier, Q4, launch" />
        </label>

        <section className="cx-board-field">
          <p className="cx-board-label">Who has it</p>
          <div className="cx-board-who">
            {members.map((p) => (
              <label key={p.key} className={`cx-chip${who.includes(p.key) ? ' is-picked' : ''}`}>
                <input type="checkbox" checked={who.includes(p.key)} onChange={() => toggle(p.key)} />
                {p.name}
              </label>
            ))}
          </div>
          {partners.length > 0 && (
            <>
              <p className="cx-board-sublabel">Partners (emailed from you when added)</p>
              <div className="cx-board-who">
                {partners.map((p) => (
                  <label key={p.key} className={`cx-chip${who.includes(p.key) ? ' is-picked' : ''}`} title={p.email ?? 'No email on file'}>
                    <input type="checkbox" checked={who.includes(p.key)} onChange={() => toggle(p.key)} />
                    {p.name}
                    {p.org ? <small>{p.org}</small> : null}
                  </label>
                ))}
              </div>
            </>
          )}
          {whoChanged && (
            <p>
              <button type="button" className="cx-btn cx-btn-sm" onClick={saveWho} disabled={savingWho}>
                {savingWho ? 'Saving…' : who.some((k) => k.startsWith('p:') && !assigned.includes(k)) ? 'Save and email partner' : 'Save'}
              </button>
            </p>
          )}
          {whoNote && <p className="cx-notice">{whoNote}</p>}
        </section>

        <section className="cx-board-field">
          <p className="cx-board-label">
            Checklist {checklist.length > 0 && <span>{checklist.filter((i) => i.done).length}/{checklist.length}</span>}
          </p>
          <ul className="cx-board-check">
            {checklist.map((i) => (
              <li key={i.id}>
                <label>
                  <input type="checkbox" checked={i.done} onChange={() => run(() => api({ op: 'check.set', id: i.id, done: !i.done }))} />
                  <span className={i.done ? 'is-done' : ''}>{i.text}</span>
                </label>
                <button type="button" className="cx-board-x" aria-label="Remove item" onClick={() => run(() => api({ op: 'check.delete', id: i.id }))}>×</button>
              </li>
            ))}
          </ul>
          <form
            className="cx-board-checkadd"
            onSubmit={(e) => {
              e.preventDefault()
              if (!newItem.trim()) return
              const text = newItem
              setNewItem('')
              run(() => api({ op: 'check.add', cardId: card.id, text }))
            }}
          >
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item" aria-label="New checklist item" />
          </form>
        </section>

        <footer>
          <button type="button" className="cx-btn cx-btn-sm" onClick={() => patch({ done: !card.done_at })}>
            {card.done_at ? 'Reopen card' : 'Mark done'}
          </button>
          <button
            type="button"
            className="cx-btn cx-btn-ghost cx-btn-sm"
            onClick={async () => {
              if (!window.confirm('Delete this card?')) return
              setMsg(null)
              onClose()
              await run(() => api({ op: 'card.delete', id: card.id }))
            }}
          >
            Delete card
          </button>
        </footer>
      </div>
    </div>
  )
}
