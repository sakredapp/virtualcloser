'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '@/app/components/PageHeader'
import {
  CARD_STAGES,
  CARD_URGENCY,
  initialsFor,
  isOverdue,
  personSubline,
  stageLabel,
  urgencyLabel,
  type ImportPayload,
  type Board,
  type BoardCard,
  type BoardList,
  type BoardPerson,
  type CardAssignee,
  type CardUrgency,
  type ChecklistItem,
} from '@/lib/boardsShared'
import { importCounts, parseBoardFile, parsePastedText } from '@/lib/boardImport'
import { classifyLink } from '@/lib/boardImportLink'
import { DialogProvider, useDialog } from '@/app/components/cxo/AppDialog'

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

export default function BoardsClient({ fresh = false }: { fresh?: boolean }) {
  return (
    <DialogProvider>
      <BoardsInner fresh={fresh} />
    </DialogProvider>
  )
}

function BoardsInner({ fresh }: { fresh: boolean }) {
  const dialog = useDialog()
  const [boards, setBoards] = useState<Board[]>([])
  const [people, setPeople] = useState<BoardPerson[]>([])
  const [me, setMe] = useState<string>('')
  const [boardId, setBoardId] = useState<string | null>(null)
  const [c, setC] = useState<Contents>(EMPTY)
  const [, setLoading] = useState(true)
  const [notReady, setNotReady] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [mine, setMine] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

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
    const name = await dialog.ask({ title: 'New board', label: 'Board name', placeholder: 'e.g. Q4 launch', confirmLabel: 'Create board' })
    if (!name?.trim()) return
    try {
      const { board: b } = await api<{ board: Board }>({ op: 'board.create', name })
      await loadBoards(b.id)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not make the board.')
    }
  }
  const saveBoardName = async (name: string) => {
    if (!board || !name.trim() || name.trim() === board.name) return
    setBoards((prev) => prev.map((b) => (b.id === board.id ? { ...b, name: name.trim() } : b)))
    await run(() => api({ op: 'board.rename', id: board.id, name }), false)
    await loadBoards(board.id)
  }
  const renameBoard = async () => {
    if (!board) return
    const name = await dialog.ask({ title: 'Rename board', label: 'Board name', initial: board.name, confirmLabel: 'Save' })
    if (!name?.trim() || name === board.name) return
    await run(() => api({ op: 'board.rename', id: board.id, name }), false)
    await loadBoards(board.id)
  }
  const deleteBoard = async () => {
    if (!board) return
    if (!(await dialog.confirm({ title: 'Delete this board?', body: `"${board.name}" and every card on it will be gone.`, confirmLabel: 'Delete board' }))) return
    await run(() => api({ op: 'board.delete', id: board.id }), false)
    await loadBoards()
  }
  const onImported = async (board: Board, cards: number, lists: number) => {
    setImportOpen(false)
    await loadBoards(board.id)
    setMsg(`Imported "${board.name}": ${lists} list${lists === 1 ? '' : 's'}, ${cards} card${cards === 1 ? '' : 's'}.`)
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
        title={board ? <BoardTitle key={board.id} name={board.name} autoFocus={fresh && boards.length === 1} onSave={saveBoardName} /> : 'Boards'}
        actions={
          <>
            <button type="button" className="cx-btn cx-btn-sm" onClick={newBoard}>+ New board</button>
            <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setImportOpen(true)}>
              Import a board
            </button>
          </>
        }
      />

      {notReady && <p className="cx-notice">Boards are being set up on this account. Try again in a minute.</p>}
      {msg && <p className="cx-notice" role="status">{msg}</p>}

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
                <ListHeader
                  list={l}
                  count={cards.length}
                  onDragStart={() => (drag.current = { kind: 'list', id: l.id })}
                  onRename={(title) => run(() => api({ op: 'list.rename', id: l.id, title }))}
                  onDelete={async () => {
                    const n = c.cards.filter((x) => x.list_id === l.id).length
                    const ok = await dialog.confirm({
                      title: 'Delete this list?',
                      body: n ? `"${l.title}" and its ${n} card${n === 1 ? '' : 's'} will be gone.` : `"${l.title}" will be gone.`,
                      confirmLabel: 'Delete list',
                    })
                    if (ok) run(() => api({ op: 'list.delete', id: l.id }))
                  }}
                />
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
                  {cards.length === 0 && (
                    <p className="cx-board-hint">{mine ? 'Nothing of yours in this list.' : 'No cards yet. Add one below, or drag one here.'}</p>
                  )}
                </div>
                <button type="button" className="cx-board-add" onClick={() => setAdding(l.id)}>
                  + Add a card
                </button>
              </section>
            )
          })}
          <AddList onAdd={(title) => run(() => api({ op: 'list.create', boardId: board.id, title }))} />
        </div>
      )}

      {board && (editingCard || adding) && (
        <CardModal
          key={editingCard?.id ?? `new-${adding}`}
          boardId={board.id}
          listId={editingCard?.list_id ?? adding!}
          lists={lists}
          card={editingCard}
          people={people}
          assigned={editingCard ? assigneesOf(editingCard.id) : []}
          checklist={editingCard ? c.checklist.filter((i) => i.card_id === editingCard.id).sort((a, b) => a.position - b.position) : []}
          onClose={() => {
            setEditing(null)
            setAdding(null)
          }}
          run={run}
          setMsg={setMsg}
        />
      )}

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onImported={onImported} />}
    </main>
  )
}

/** Close a popover when the pointer goes down outside it. */
function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, open, close])
}

/** List title is plain text. Pencil (or a click on the title) edits; Enter/blur saves, Esc cancels. ⋯ holds Rename and Delete. */
function ListHeader({
  list,
  count,
  onDragStart,
  onRename,
  onDelete,
}: {
  list: BoardList
  count: number
  onDragStart: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(list.title)
  const [menu, setMenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setMenu(false), [])
  useOutside(menuRef, menu, closeMenu)
  useEffect(() => setV(list.title), [list.title])
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])
  const start = () => {
    setMenu(false)
    setV(list.title)
    setEditing(true)
  }
  const save = () => {
    if (!editing) return
    setEditing(false)
    const t = v.trim()
    if (t && t !== list.title) onRename(t)
    else setV(list.title)
  }
  return (
    <header
      className="cx-board-col-head"
      draggable={!editing}
      onDragStart={(e) => {
        onDragStart()
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="cx-board-col-title"
          value={v}
          maxLength={120}
          aria-label="List name"
          onChange={(e) => setV(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setV(list.title)
              setEditing(false)
            }
          }}
        />
      ) : (
        <h3 className="cx-board-col-name" onClick={start} title="Click to rename">
          {list.title}
        </h3>
      )}
      {!editing && <span className="cx-board-count">{count}</span>}
      {!editing && (
        <button type="button" className="cx-board-icon" aria-label={`Rename list ${list.title}`} title="Edit name" onClick={start}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M11.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4L6 12.4 3 13l.6-3 7.7-7.7Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {!editing && (
        <div className="cx-board-pop" ref={menuRef}>
          <button type="button" className="cx-board-icon" aria-label={`More for list ${list.title}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            ⋯
          </button>
          {menu && (
            <div className="cx-board-popmenu" role="menu">
              <button type="button" role="menuitem" onClick={start}>Rename</button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  setMenu(false)
                  onDelete()
                }}
              >
                Delete list
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  )
}

function Avatar({ p, size = 22 }: { p: BoardPerson; size?: number }) {
  return (
    <b className={`cx-board-av${p.kind === 'partner' ? ' is-partner' : ''}`} style={{ width: size, height: size, fontSize: size < 24 ? 10 : 11 }} aria-hidden="true">
      {initialsFor(p.name)}
    </b>
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
  const late = !card.done_at && isOverdue(card.due_date)
  const urg = urgencyLabel(card.urgency)
  const done = checklist.filter((i) => i.done).length
  const partners = people.filter((p) => p.kind === 'partner')
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
      {card.tags.length > 0 && (
        <p className="cx-board-tags">
          {card.tags.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </p>
      )}
      {partners.length > 0 && (
        <p className="cx-board-partners">
          With {partners.map((p) => p.name).join(', ')}
        </p>
      )}
      {(due || urg || checklist.length > 0 || people.length > 0) && (
        <div className="cx-board-card-meta">
          {due && <span className={`cx-board-due${late ? ' is-late' : ''}`}>{late ? 'Overdue · ' : 'Due '}{due}</span>}
          {urg && <span className={card.urgency === 'now' ? 'is-now' : ''}>{urg}</span>}
          {checklist.length > 0 && (
            <span className="cx-board-checkcount" title="Checklist">
              ☑ {done}/{checklist.length}
            </span>
          )}
          {people.length > 0 && (
            <span className="cx-board-people">
              {people.slice(0, 4).map((p) => (
                <span key={p.key} title={p.kind === 'partner' ? `${p.name}${p.org ? `, ${p.org}` : ''} (partner)` : p.name}>
                  <Avatar p={p} />
                </span>
              ))}
              {people.length > 4 && <small>+{people.length - 4}</small>}
            </span>
          )}
        </div>
      )}
    </article>
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

/** Searchable, multi-select: exec team and partners in one list. */
function WhoPicker({ people, value, onChange }: { people: BoardPerson[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useOutside(boxRef, open, close)
  const byKey = useMemo(() => new Map(people.map((p) => [p.key, p])), [people])
  const picked = value.map((k) => byKey.get(k)).filter(Boolean) as BoardPerson[]
  const needle = q.trim().toLowerCase()
  const match = (p: BoardPerson) =>
    !needle || [p.name, p.email, p.org, p.role].some((x) => (x || '').toLowerCase().includes(needle))
  const members = people.filter((p) => p.kind === 'member' && match(p))
  const partners = people.filter((p) => p.kind === 'partner' && match(p))
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])
  const row = (p: BoardPerson) => {
    const on = value.includes(p.key)
    return (
      <li key={p.key}>
        <button type="button" role="option" aria-selected={on} className={on ? 'is-on' : ''} onClick={() => toggle(p.key)}>
          <Avatar p={p} size={26} />
          <span className="cx-who-name">
            {p.name}
            <small>{personSubline(p, people)}</small>
          </span>
          <span className="cx-who-tick" aria-hidden="true">{on ? '✓' : ''}</span>
        </button>
      </li>
    )
  }
  return (
    <div className="cx-who" ref={boxRef}>
      {picked.length > 0 && (
        <div className="cx-who-picked">
          {picked.map((p) => (
            <span key={p.key} className="cx-who-chip">
              <Avatar p={p} size={20} />
              {p.name}
              {p.kind === 'partner' && <small>partner</small>}
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => toggle(p.key)}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        className="cx-who-search"
        value={q}
        placeholder="Search your team and partners"
        aria-label="Search people"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && (open || q)) {
            e.stopPropagation()
            setQ('')
            setOpen(false)
          }
        }}
      />
      {open && (
        <div className="cx-who-list" role="listbox" aria-multiselectable="true">
          {members.length > 0 && (
            <>
              <p className="cx-who-group">Your team</p>
              <ul>{members.map(row)}</ul>
            </>
          )}
          <p className="cx-who-group">Partners</p>
          {partners.length > 0 ? (
            <ul>{partners.map(row)}</ul>
          ) : (
            <p className="cx-who-none">{people.some((p) => p.kind === 'partner') ? 'No partner matches.' : 'No partners yet. Add them on the Partners page.'}</p>
          )}
        </div>
      )}
    </div>
  )
}

type DraftItem = { id?: string; text: string; done: boolean }

/** One window for a new card and an existing one. Nothing saves until Add card / Save. */
function CardModal({
  boardId,
  listId,
  lists,
  card,
  people,
  assigned,
  checklist,
  onClose,
  run,
  setMsg,
}: {
  boardId: string
  listId: string
  lists: BoardList[]
  card: BoardCard | null
  people: BoardPerson[]
  assigned: string[]
  checklist: ChecklistItem[]
  onClose: () => void
  run: (fn: () => Promise<unknown>, reload?: boolean) => Promise<void>
  setMsg: (m: string | null) => void
}) {
  const dialog = useDialog()
  const isNew = !card
  const [title, setTitle] = useState(card?.title ?? '')
  const [stage, setStage] = useState<string | null>(card?.label_color ?? null)
  const [when, setWhen] = useState<CardUrgency | null>(card?.urgency ?? null)
  const [due, setDue] = useState(card?.due_date ?? '')
  const [notes, setNotes] = useState(card?.notes ?? '')
  const [tags, setTags] = useState<string[]>(card?.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [who, setWho] = useState<string[]>(assigned)
  const [items, setItems] = useState<DraftItem[]>(checklist.map((i) => ({ id: i.id, text: i.text, done: i.done })))
  const [newItem, setNewItem] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isNew) titleRef.current?.focus()
  }, [isNew])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const listName = lists.find((l) => l.id === listId)?.title
  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '')
    if (t && !tags.includes(t)) setTags((x) => [...x, t].slice(0, 12))
    setTagDraft('')
  }
  const addItem = () => {
    const text = newItem.trim()
    if (!text) return
    setItems((x) => [...x, { text, done: false }])
    setNewItem('')
  }
  const emailsPartner = who.some((k) => k.startsWith('p:') && !assigned.includes(k) && people.find((p) => p.key === k)?.email)

  const save = async () => {
    const t = title.trim()
    if (!t) {
      setErr('Give the card a title.')
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    setErr(null)
    const allTags = tagDraft.trim() ? [...tags, tagDraft.trim().replace(/^#/, '')] : tags
    const fields = { label_color: stage, urgency: when, due_date: due || null, notes: notes.trim() || null, tags: allTags }
    try {
      let note: string | null = null
      const describe = (r: { notified?: string[]; notNotified?: Array<{ name: string; reason: string }> }) => {
        const parts: string[] = []
        if (r.notified?.length) parts.push(`Emailed ${r.notified.join(', ')}.`)
        for (const n of r.notNotified ?? []) parts.push(`${n.name} was not emailed: ${n.reason}`)
        return parts.join(' ') || null
      }
      if (isNew) {
        const r = await api<{ card: BoardCard; notified?: string[]; notNotified?: Array<{ name: string; reason: string }> }>({
          op: 'card.create',
          boardId,
          listId,
          title: t,
          patch: fields,
          checklist: items.map((i) => i.text),
          keys: who,
        })
        note = describe(r)
        const doneIds: string[] = []
        if (items.some((i) => i.done)) {
          const res = await fetch(`/api/boards?board=${encodeURIComponent(boardId)}`, { cache: 'no-store' })
          const j = (await res.json().catch(() => ({}))) as { checklist?: ChecklistItem[] }
          const mine = (j.checklist ?? []).filter((i) => i.card_id === r.card.id).sort((a, b) => a.position - b.position)
          items.forEach((it, ix) => it.done && mine[ix] && doneIds.push(mine[ix].id))
          await Promise.all(doneIds.map((id) => api({ op: 'check.set', id, done: true })))
        }
      } else {
        const patch: Record<string, unknown> = {}
        if (t !== card.title) patch.title = t
        if (fields.label_color !== card.label_color) patch.label_color = fields.label_color
        if (fields.urgency !== card.urgency) patch.urgency = fields.urgency
        if (fields.due_date !== card.due_date) patch.due_date = fields.due_date
        if (fields.notes !== (card.notes || null)) patch.notes = fields.notes
        if (allTags.join('\u0001') !== card.tags.join('\u0001')) patch.tags = allTags
        if (Object.keys(patch).length) await api({ op: 'card.update', id: card.id, patch })
        // Checklist: diff the draft against what is saved.
        const kept = new Set(items.filter((i) => i.id).map((i) => i.id))
        for (const old of checklist) if (!kept.has(old.id)) await api({ op: 'check.delete', id: old.id })
        for (const it of items) {
          if (it.id) {
            const old = checklist.find((o) => o.id === it.id)
            if (old && old.done !== it.done) await api({ op: 'check.set', id: it.id, done: it.done })
          } else {
            const { item } = await api<{ item: ChecklistItem }>({ op: 'check.add', cardId: card.id, text: it.text })
            if (it.done) await api({ op: 'check.set', id: item.id, done: true })
          }
        }
        if (who.slice().sort().join() !== assigned.slice().sort().join()) {
          note = describe(await api({ op: 'card.assign', id: card.id, keys: who }))
        }
      }
      onClose()
      await run(async () => {})
      setMsg(note)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not save.')
      setSaving(false)
    }
  }

  return (
    <div className="cx-board-modal" role="dialog" aria-modal="true" aria-label={isNew ? 'Add a card' : 'Edit card'} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="cx-board-editor"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <header>
          <div className="cx-board-editor-head">
            <p className="cx-board-label">{isNew ? `Add a card${listName ? ` to ${listName}` : ''}` : `Card${listName ? ` in ${listName}` : ''}`}</p>
            <input
              ref={titleRef}
              className="cx-board-editor-title"
              value={title}
              maxLength={300}
              placeholder="What needs doing?"
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Card title"
            />
          </div>
          <button type="button" className="cx-board-x" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="cx-board-field">
          <p className="cx-board-label">Stage</p>
          <div className="cx-board-pills">
            <button type="button" className={!stage ? 'is-on' : ''} onClick={() => setStage(null)}>None</button>
            {CARD_STAGES.map((st) => (
              <button key={st.color} type="button" className={stage === st.color ? 'is-on' : ''} onClick={() => setStage(st.color)}>
                <i style={{ background: st.color }} />
                {st.label}
              </button>
            ))}
          </div>
        </div>

        <div className="cx-board-editor-grid">
          <div className="cx-board-field">
            <p className="cx-board-label">When</p>
            <div className="cx-board-pills">
              {CARD_URGENCY.map((u) => (
                <button key={u.value} type="button" className={when === u.value ? 'is-on' : ''} onClick={() => setWhen(when === u.value ? null : u.value)}>
                  {u.label}
                </button>
              ))}
            </div>
          </div>
          <label className="cx-board-field">
            <span className="cx-board-label">Due</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>

        <label className="cx-board-field">
          <span className="cx-board-label">Notes</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, links, what done looks like" />
        </label>

        <div className="cx-board-field">
          <p className="cx-board-label">Tags</p>
          <div className="cx-board-taginput">
            {tags.map((t) => (
              <span key={t} className="cx-board-tagchip">
                {t}
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags((x) => x.filter((y) => y !== t))}>×</button>
              </span>
            ))}
            <input
              value={tagDraft}
              placeholder={tags.length ? 'Add a tag' : 'carrier, Q4, launch'}
              aria-label="Add a tag"
              onChange={(e) => {
                const v = e.target.value
                if (v.endsWith(',')) addTag(v.slice(0, -1))
                else setTagDraft(v)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag(tagDraft)
                } else if (e.key === 'Backspace' && !tagDraft && tags.length) setTags((x) => x.slice(0, -1))
              }}
              onBlur={() => tagDraft.trim() && addTag(tagDraft)}
            />
          </div>
        </div>

        <div className="cx-board-field">
          <p className="cx-board-label">Who has it</p>
          <WhoPicker people={people} value={who} onChange={setWho} />
          {emailsPartner && <p className="cx-board-sublabel">New partners on this card get an email from you when you save.</p>}
        </div>

        <div className="cx-board-field">
          <p className="cx-board-label">
            Checklist {items.length > 0 && <span>{items.filter((i) => i.done).length}/{items.length}</span>}
          </p>
          {items.length > 0 && (
            <ul className="cx-board-check">
              {items.map((it, ix) => (
                <li key={it.id ?? `n${ix}`}>
                  <label>
                    <input type="checkbox" checked={it.done} onChange={() => setItems((x) => x.map((y, j) => (j === ix ? { ...y, done: !y.done } : y)))} />
                    <span className={it.done ? 'is-done' : ''}>{it.text}</span>
                  </label>
                  <button type="button" className="cx-board-x" aria-label="Remove item" onClick={() => setItems((x) => x.filter((_, j) => j !== ix))}>×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="cx-board-checkadd">
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addItem()
                }
              }}
              placeholder="Add an item, then Enter"
              aria-label="New checklist item"
            />
          </div>
        </div>

        {err && <p className="cx-board-err" role="alert">{err}</p>}

        <footer>
          {!isNew && (
            <div className="cx-board-footside">
              <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => run(() => api({ op: 'card.update', id: card.id, patch: { done: !card.done_at } }))}>
                {card.done_at ? 'Reopen' : 'Mark done'}
              </button>
              <button
                type="button"
                className="cx-btn cx-btn-ghost cx-btn-sm"
                onClick={async () => {
                  if (!(await dialog.confirm({ title: 'Delete this card?', body: card.title, confirmLabel: 'Delete card' }))) return
                  setMsg(null)
                  onClose()
                  await run(() => api({ op: 'card.delete', id: card.id }))
                }}
              >
                Delete
              </button>
            </div>
          )}
          <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="cx-btn cx-btn-sm" disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Add card' : emailsPartner ? 'Save and email partner' : 'Save'}
          </button>
        </footer>
      </form>
    </div>
  )
}

type ImportTab = 'link' | 'text'

/** Import a board: paste a link (default), paste text, or upload a file. Preview first, then import. */
function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (b: Board, cards: number, lists: number) => void }) {
  const [tab, setTab] = useState<ImportTab>('link')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPayload | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'read' | 'import' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const linkHint = useMemo(() => {
    if (!url.trim()) return null
    const k = classifyLink(url)
    if (k.kind === 'other-tool') return `${k.tool} boards can't be read from a link. In ${k.tool}, export the board to CSV, then use Upload a file.`
    if (k.kind === 'trello-card') return 'That is a link to one card. Paste the board link (it has /b/ in it).'
    if (k.kind === 'unknown' && /\./.test(url)) return 'Paste a Trello board link (trello.com/b/…) or a Google Sheets link.'
    return null
  }, [url])

  const show = (p: ImportPayload) => {
    setPreview(p)
    setName(p.name)
    setErr(null)
  }
  const readLink = async () => {
    setErr(null)
    setBusy('read')
    try {
      const { payload } = await api<{ payload: ImportPayload }>({ op: 'board.importLink', url })
      show(payload)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'We could not read that link.')
    }
    setBusy(null)
  }
  const readText = () => {
    try {
      show(parsePastedText(text))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'We could not read that text.')
    }
  }
  const readFile = async (file: File) => {
    try {
      const p = parseBoardFile(file.name, await file.text())
      show({ ...p, source: 'file' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That file could not be read.')
    }
    if (fileRef.current) fileRef.current.value = ''
  }
  const doImport = async () => {
    if (!preview) return
    setBusy('import')
    setErr(null)
    try {
      const payload = { ...preview, name: name.trim() || preview.name }
      const res = await api<{ board: Board; cards: number }>({ op: 'board.import', payload })
      onImported(res.board, res.cards, payload.lists.length)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not import.')
      setBusy(null)
    }
  }

  const counts = preview ? importCounts(preview) : null

  return (
    <div className="cx-board-modal" role="dialog" aria-modal="true" aria-label="Import a board" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cx-board-editor cx-import">
        <header>
          <h2 className="cx-import-title">Import a board</h2>
          <button type="button" className="cx-board-x" aria-label="Close" onClick={onClose}>×</button>
        </header>

        {!preview ? (
          <>
            <div className="cx-board-seg cx-import-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'link'} className={tab === 'link' ? 'is-on' : ''} onClick={() => { setTab('link'); setErr(null) }}>
                Paste a link
              </button>
              <button type="button" role="tab" aria-selected={tab === 'text'} className={tab === 'text' ? 'is-on' : ''} onClick={() => { setTab('text'); setErr(null) }}>
                Paste text
              </button>
            </div>

            {tab === 'link' ? (
              <form
                className="cx-import-body"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (url.trim()) readLink()
                }}
              >
                <label className="cx-board-field">
                  <span className="cx-board-label">Board link</span>
                  <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://trello.com/b/… or a Google Sheets link" aria-label="Board link" />
                </label>
                <p className="cx-board-sublabel">{linkHint ?? 'Trello boards and Google Sheets. From Asana, Monday, Notion or Airtable: export to CSV and upload it.'}</p>
                <footer>
                  <button type="button" className="cx-import-file" onClick={() => fileRef.current?.click()}>Upload a file instead</button>
                  <button type="submit" className="cx-btn cx-btn-sm" disabled={!url.trim() || busy === 'read'}>
                    {busy === 'read' ? 'Reading…' : 'Read board'}
                  </button>
                </footer>
              </form>
            ) : (
              <div className="cx-import-body">
                <label className="cx-board-field">
                  <span className="cx-board-label">Tasks</span>
                  <textarea
                    autoFocus
                    rows={8}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={'One task per line, or rows copied from a spreadsheet.\n\nTo do:\n- Call the carrier\n- Send the Q4 deck\nDone:\n[x] Book the venue'}
                  />
                </label>
                <p className="cx-board-sublabel">&quot;Heading:&quot; lines start a new list. Indented lines become a checklist.</p>
                <footer>
                  <button type="button" className="cx-import-file" onClick={() => fileRef.current?.click()}>Upload a file instead</button>
                  <button type="button" className="cx-btn cx-btn-sm" disabled={!text.trim()} onClick={readText}>Preview</button>
                </footer>
              </div>
            )}
          </>
        ) : (
          <div className="cx-import-body">
            <label className="cx-board-field">
              <span className="cx-board-label">Board name</span>
              <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Board name" />
            </label>
            <p className="cx-import-counts">
              <b>{counts!.lists}</b> list{counts!.lists === 1 ? '' : 's'} · <b>{counts!.cards}</b> card{counts!.cards === 1 ? '' : 's'}
              {counts!.checklist > 0 && (
                <>
                  {' '}· <b>{counts!.checklist}</b> checklist item{counts!.checklist === 1 ? '' : 's'}
                </>
              )}
            </p>
            <ul className="cx-import-lists">
              {preview.lists.slice(0, 8).map((l, i) => (
                <li key={i}>
                  <span>{l.title}</span>
                  <small>{l.cards.length}</small>
                </li>
              ))}
              {preview.lists.length > 8 && <li className="is-more">+{preview.lists.length - 8} more lists</li>}
            </ul>
            <footer>
              <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => { setPreview(null); setErr(null) }}>Back</button>
              <button type="button" className="cx-btn cx-btn-sm" disabled={busy === 'import' || !counts!.cards} onClick={doImport}>
                {busy === 'import' ? 'Importing…' : 'Import board'}
              </button>
            </footer>
          </div>
        )}

        {err && <p className="cx-board-err" role="alert">{err}</p>}
        <input ref={fileRef} type="file" accept=".json,.csv,application/json,text/csv" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
      </div>
    </div>
  )
}

/** The board name in the header: click it to rename; Enter saves, Esc cancels. */
function BoardTitle({ name, autoFocus, onSave }: { name: string; autoFocus: boolean; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(autoFocus)
  const [value, setValue] = useState(name)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])
  useEffect(() => setValue(name), [name])
  if (!editing)
    return (
      <button type="button" className="cx-board-titleedit" title="Rename board" onClick={() => setEditing(true)}>
        {name}
      </button>
    )
  const save = () => {
    setEditing(false)
    if (value.trim() && value.trim() !== name) onSave(value.trim())
    else setValue(name)
  }
  return (
    <input
      ref={ref}
      className="cx-board-titleinput"
      value={value}
      maxLength={120}
      aria-label="Board name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          setValue(name)
          setEditing(false)
        }
      }}
    />
  )
}
