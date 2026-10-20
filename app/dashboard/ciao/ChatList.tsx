'use client'

/**
 * The Ciao screen's chat list (owner 2026-10-20: "folders and such, whatever
 * UI formatting stuff usually there is for chats, keep things clean").
 *
 *   Search    a small field that filters chat titles (Gumloop's search above Recents)
 *   Folders   above Recent with a quiet "+" (ChatGPT's Projects above "Your chats")
 *   Recent    pinned chats first, then the rest; a chat in a folder lives in its folder
 *   "..."     on every row, on hover/focus (always on touch): Rename, Pin, Move to
 *             folder, Delete (Dropbox Dash / Linear row menus). Delete asks inside
 *             the menu, never a browser dialog.
 *
 * Every change is optimistic and goes to POST /api/mira/chats; a failure puts
 * the list back from the server and shows the reason in one quiet line. Before
 * the folders migration runs (organize = false) the list shows only search
 * and the chats, with no menus.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'

export type Chat = { id: string; last_at: string; title: string; pinned?: boolean; folder_id?: string | null }
export type Folder = { id: string; name: string; created_at: string }
export type RunOrganize = (body: Record<string, unknown>) => Promise<{ ok: boolean; folder?: Folder } | null>

const FOLDER_NAME_MAX = 40
const CHAT_TITLE_MAX = 80
const MENU_W = 216

export function when(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days < 1) return 'Today'
  if (days < 2) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const sw = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const I = {
  search: <svg viewBox="0 0 16 16" {...sw} strokeWidth="1.4" aria-hidden="true"><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" /></svg>,
  plus: <svg viewBox="0 0 16 16" {...sw} strokeWidth="1.4" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>,
  more: <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2" fill="currentColor" /><circle cx="8" cy="8" r="1.2" fill="currentColor" /><circle cx="12.5" cy="8" r="1.2" fill="currentColor" /></svg>,
  folder: <svg viewBox="0 0 16 16" {...sw} strokeWidth="1.3" aria-hidden="true"><path d="M2 4.75A1.25 1.25 0 0 1 3.25 3.5h2.6l1.4 1.5h5.5A1.25 1.25 0 0 1 14 6.25v5.5A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75z" /></svg>,
  chevron: <svg viewBox="0 0 16 16" {...sw} strokeWidth="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>,
  back: <svg viewBox="0 0 16 16" {...sw} strokeWidth="1.5" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>,
  pin: <svg viewBox="0 0 16 16" {...sw} strokeWidth="1.3" aria-hidden="true"><path d="M9.75 2.5 13.5 6.25l-2 .75-2.25 2.25.25 2.75-1 1L5.75 10.25 3 13M5.75 10.25 2.75 7.25l1-1 2.75.25L8.75 4.25z" /></svg>,
  pencil: <svg viewBox="0 0 16 16" {...sw} strokeWidth="1.3" aria-hidden="true"><path d="M10.5 3 13 5.5 6 12.5H3.5V10z" /></svg>,
  trash: <svg viewBox="0 0 16 16" {...sw} strokeWidth="1.3" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.25a1 1 0 0 0 1 .75h3.8a1 1 0 0 0 1-.75l.6-8.25" /></svg>,
  out: <svg viewBox="0 0 16 16" {...sw} strokeWidth="1.3" aria-hidden="true"><path d="M2 4.75A1.25 1.25 0 0 1 3.25 3.5h2.6l1.4 1.5h5.5A1.25 1.25 0 0 1 14 6.25v5.5A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75zM6 9h4" /></svg>,
  check: <svg viewBox="0 0 16 16" {...sw} strokeWidth="1.6" aria-hidden="true"><path d="m3.5 8.5 3 3 6-6.5" /></svg>,
}

type Menu = { kind: 'chat' | 'folder'; id: string; view: 'main' | 'move' | 'confirm'; top?: number; bottom?: number; left: number }

/** An inline name field: Enter or leaving it saves, Escape cancels. */
function NameField({ initial, max, label, onDone }: { initial: string; max: number; label: string; onDone: (value: string | null) => void }) {
  const [v, setV] = useState(initial)
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      className="ciao-namefield"
      value={v}
      maxLength={max}
      aria-label={label}
      placeholder={label}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(v) }
        if (e.key === 'Escape') { e.preventDefault(); finish(null) }
      }}
      onBlur={() => finish(v)}
    />
  )
}

export default function ChatList({
  chats, folders, organize, loaded, isActive, onOpen, setChats, setFolders, run,
}: {
  chats: Chat[]
  folders: Folder[]
  organize: boolean
  loaded: boolean
  isActive: (id: string) => boolean
  onOpen: (id: string) => void
  setChats: Dispatch<SetStateAction<Chat[]>>
  setFolders: Dispatch<SetStateAction<Folder[]>>
  run: RunOrganize
}) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [renaming, setRenaming] = useState<{ kind: 'chat' | 'folder'; id: string } | null>(null)
  /** Creating a folder; `move` = the chat to put in it once made. */
  const [creating, setCreating] = useState<{ move?: string } | null>(null)
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())
  const menuEl = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders])
  const inFolder = (c: Chat) => !!c.folder_id && folderIds.has(c.folder_id)
  const recent = useMemo(() => {
    const loose = chats.filter((c) => !(c.folder_id && folderIds.has(c.folder_id)))
    return [...loose.filter((c) => c.pinned), ...loose.filter((c) => !c.pinned)]
  }, [chats, folderIds])
  const q = query.trim().toLowerCase()
  const found = q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : null

  // The open chat's folder opens when that chat is opened (and can then be closed).
  const activeFolder = chats.find((c) => c.folder_id && isActive(c.id))?.folder_id ?? null
  useEffect(() => {
    if (activeFolder) setOpenFolders((s) => (s.has(activeFolder) ? s : new Set(s).add(activeFolder)))
  }, [activeFolder])

  const closeMenu = useCallback(() => setMenu(null), [])
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu() } }
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (menuEl.current?.contains(t)) return
      if ((t as Element).closest?.('.ciao-row__more[aria-expanded="true"]')) return
      closeMenu()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    window.addEventListener('resize', closeMenu)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menu, closeMenu])
  // Focus the first item whenever the menu opens or changes view.
  useLayoutEffect(() => {
    if (menu) menuEl.current?.querySelector<HTMLElement>('button')?.focus()
  }, [menu?.id, menu?.view]) // eslint-disable-line react-hooks/exhaustive-deps

  function openMenu(kind: Menu['kind'], id: string, btn: HTMLElement) {
    if (menu && menu.id === id && menu.kind === kind) return closeMenu()
    const r = btn.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8))
    // Near the bottom of the window the menu opens upwards.
    const flip = r.bottom + 240 > window.innerHeight
    setMenu(flip ? { kind, id, view: 'main', bottom: window.innerHeight - r.top + 4, left } : { kind, id, view: 'main', top: r.bottom + 4, left })
  }

  // ── actions ────────────────────────────────────────────────────────────
  const patchChat = (id: string, p: Partial<Chat>) => setChats((cur) => cur.map((c) => (c.id === id ? { ...c, ...p } : c)))

  function renameChat(id: string, value: string | null) {
    setRenaming(null)
    const c = chats.find((x) => x.id === id)
    if (value === null || !c) return
    const title = value.replace(/\s+/g, ' ').trim().slice(0, CHAT_TITLE_MAX)
    if (title === c.title) return
    if (title) patchChat(id, { title })
    void run({ action: 'rename_chat', id, title })
  }
  function pinChat(id: string, pinned: boolean) {
    closeMenu()
    patchChat(id, { pinned })
    void run({ action: 'pin_chat', id, pinned })
  }
  function moveChat(id: string, folderId: string | null) {
    closeMenu()
    patchChat(id, { folder_id: folderId })
    if (folderId) setOpenFolders((s) => new Set(s).add(folderId))
    void run({ action: 'move_chat', id, folder_id: folderId })
  }
  function deleteChat(id: string) {
    closeMenu()
    setChats((cur) => cur.filter((c) => c.id !== id))
    void run({ action: 'delete_chat', id })
  }
  async function createFolder(value: string | null) {
    const move = creating?.move
    setCreating(null)
    const name = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX)
    if (!name) return
    const j = await run({ action: 'create_folder', name })
    if (!j?.folder) return
    const f = j.folder
    setFolders((cur) => (cur.some((x) => x.id === f.id) ? cur : [...cur, f]))
    setOpenFolders((s) => new Set(s).add(f.id))
    if (move) moveChat(move, f.id)
  }
  function renameFolder(id: string, value: string | null) {
    setRenaming(null)
    const f = folders.find((x) => x.id === id)
    const name = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX)
    if (value === null || !f || !name || name === f.name) return
    setFolders((cur) => cur.map((x) => (x.id === id ? { ...x, name } : x)))
    void run({ action: 'rename_folder', id, name })
  }
  function deleteFolder(id: string) {
    closeMenu()
    // Its chats go back to Recent; nothing is deleted with it.
    setFolders((cur) => cur.filter((f) => f.id !== id))
    setChats((cur) => cur.map((c) => (c.folder_id === id ? { ...c, folder_id: null } : c)))
    void run({ action: 'delete_folder', id })
  }

  // ── rows ───────────────────────────────────────────────────────────────
  const more = (kind: Menu['kind'], id: string, label: string) => organize && (
    <button
      type="button"
      className="ciao-row__more"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={menu?.kind === kind && menu.id === id}
      onClick={(e) => openMenu(kind, id, e.currentTarget)}
    >
      {I.more}
    </button>
  )

  const chatRow = (c: Chat, nested = false) => {
    if (renaming?.kind === 'chat' && renaming.id === c.id) {
      return (
        <div key={c.id} className="ciao-row" data-nested={nested || undefined} data-editing="">
          <NameField initial={c.title} max={CHAT_TITLE_MAX} label="Chat name" onDone={(v) => renameChat(c.id, v)} />
        </div>
      )
    }
    const active = isActive(c.id)
    return (
      <div key={c.id} className="ciao-row" data-nested={nested || undefined} data-open={(menu?.kind === 'chat' && menu.id === c.id) || undefined}>
        <button type="button" className="ciao-chat" aria-current={active || undefined} onClick={() => onOpen(c.id)} title={c.title}>
          {c.pinned && !nested && <span className="ciao-chat__pin" aria-label="Pinned">{I.pin}</span>}
          <span className="ciao-chat__title">{c.title}</span>
          <span className="ciao-chat__when">{when(c.last_at)}</span>
        </button>
        {more('chat', c.id, `More for ${c.title}`)}
      </div>
    )
  }

  const folderRow = (f: Folder) => {
    const inside = chats.filter((c) => c.folder_id === f.id)
    const open = openFolders.has(f.id)
    const toggle = () => setOpenFolders((s) => {
      const n = new Set(s)
      if (n.has(f.id)) n.delete(f.id)
      else n.add(f.id)
      return n
    })
    return (
      <div key={f.id} className="ciao-folder" data-open={open || undefined}>
        {renaming?.kind === 'folder' && renaming.id === f.id ? (
          <div className="ciao-row" data-editing="">
            <NameField initial={f.name} max={FOLDER_NAME_MAX} label="Folder name" onDone={(v) => renameFolder(f.id, v)} />
          </div>
        ) : (
          <div className="ciao-row" data-open={(menu?.kind === 'folder' && menu.id === f.id) || undefined}>
            <button type="button" className="ciao-chat ciao-chat--folder" aria-expanded={open} onClick={toggle} title={f.name}>
              <span className="ciao-chat__icon">{I.folder}</span>
              <span className="ciao-chat__title">{f.name}</span>
              <span className="ciao-chat__when">{inside.length || ''}</span>
            </button>
            {more('folder', f.id, `More for folder ${f.name}`)}
          </div>
        )}
        {open && (
          <div className="ciao-folder__chats" role="group" aria-label={f.name}>
            {inside.length === 0 ? <p className="ciao-folder__none">Empty. Use a chat&rsquo;s &ldquo;&hellip;&rdquo; menu to move it here.</p> : inside.map((c) => chatRow(c, true))}
          </div>
        )}
      </div>
    )
  }

  // ── the menu ───────────────────────────────────────────────────────────
  const menuChat = menu?.kind === 'chat' ? chats.find((c) => c.id === menu.id) : undefined
  const menuFolder = menu?.kind === 'folder' ? folders.find((f) => f.id === menu.id) : undefined
  const item = (icon: React.ReactNode, label: string, onClick: () => void, opts: { danger?: boolean; on?: boolean; sub?: boolean } = {}) => (
    <button type="button" role="menuitem" className="ciao-menu__item" data-danger={opts.danger || undefined} onClick={onClick}>
      <span className="ciao-menu__icon">{icon}</span>
      <span className="ciao-menu__label">{label}</span>
      {opts.on && <span className="ciao-menu__tick">{I.check}</span>}
      {opts.sub && <span className="ciao-menu__sub">{I.chevron}</span>}
    </button>
  )
  let menuBody: React.ReactNode = null
  if (menu && menuChat) {
    if (menu.view === 'main') {
      menuBody = (
        <>
          {item(I.pencil, 'Rename', () => { closeMenu(); setRenaming({ kind: 'chat', id: menuChat.id }) })}
          {item(I.pin, menuChat.pinned ? 'Unpin' : 'Pin to top', () => pinChat(menuChat.id, !menuChat.pinned))}
          {item(I.folder, 'Move to folder', () => setMenu({ ...menu, view: 'move' }), { sub: true })}
          <hr className="ciao-menu__rule" />
          {item(I.trash, 'Delete', () => setMenu({ ...menu, view: 'confirm' }), { danger: true })}
        </>
      )
    } else if (menu.view === 'move') {
      menuBody = (
        <>
          <button type="button" className="ciao-menu__head" onClick={() => setMenu({ ...menu, view: 'main' })}>{I.back}<span>Move to folder</span></button>
          <div className="ciao-menu__scroll">
            {folders.map((f) => <span key={f.id}>{item(I.folder, f.name, () => moveChat(menuChat.id, f.id), { on: menuChat.folder_id === f.id })}</span>)}
          </div>
          {folders.length > 0 && <hr className="ciao-menu__rule" />}
          {inFolder(menuChat) && item(I.out, 'Remove from folder', () => moveChat(menuChat.id, null))}
          {item(I.plus, 'New folder', () => { closeMenu(); setCreating({ move: menuChat.id }) })}
        </>
      )
    } else {
      menuBody = (
        <div className="ciao-menu__confirm" role="alertdialog" aria-label="Delete this chat?">
          <p className="ciao-menu__q">Delete this chat?</p>
          <p className="ciao-menu__note">It leaves your list for good.</p>
          <div className="ciao-menu__btns">
            <button type="button" className="ciao-menu__btn" onClick={() => setMenu({ ...menu, view: 'main' })}>Cancel</button>
            <button type="button" className="ciao-menu__btn" data-danger="" onClick={() => deleteChat(menuChat.id)}>Delete</button>
          </div>
        </div>
      )
    }
  } else if (menu && menuFolder) {
    menuBody = menu.view === 'confirm' ? (
      <div className="ciao-menu__confirm" role="alertdialog" aria-label="Delete this folder?">
        <p className="ciao-menu__q">Delete &ldquo;{menuFolder.name}&rdquo;?</p>
        <p className="ciao-menu__note">Its chats go back to Recent. No chat is deleted.</p>
        <div className="ciao-menu__btns">
          <button type="button" className="ciao-menu__btn" onClick={() => setMenu({ ...menu, view: 'main' })}>Cancel</button>
          <button type="button" className="ciao-menu__btn" data-danger="" onClick={() => deleteFolder(menuFolder.id)}>Delete</button>
        </div>
      </div>
    ) : (
      <>
        {item(I.pencil, 'Rename', () => { closeMenu(); setRenaming({ kind: 'folder', id: menuFolder.id }) })}
        <hr className="ciao-menu__rule" />
        {item(I.trash, 'Delete folder', () => setMenu({ ...menu, view: 'confirm' }), { danger: true })}
      </>
    )
  }

  return (
    <>
      <label className="ciao-search">
        {I.search}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery('') } }}
          placeholder="Search chats"
          aria-label="Search chats"
          enterKeyHint="search"
        />
      </label>

      <nav className="ciao-side__list" aria-label="Chats" onScroll={menu ? closeMenu : undefined}>
        {found ? (
          <>
            <p className="ciao-side__label">Results</p>
            {found.length === 0 ? <p className="ciao-side__none">No chat matches &ldquo;{query.trim()}&rdquo;.</p> : found.map((c) => chatRow(c))}
          </>
        ) : (
          <>
            {organize && (
              <>
                <div className="ciao-side__labelrow">
                  <p className="ciao-side__label">Folders</p>
                  <button type="button" className="ciao-side__add" onClick={() => setCreating({})} aria-label="New folder" title="New folder">{I.plus}</button>
                </div>
                {creating && (
                  <div className="ciao-row" data-editing="">
                    <NameField initial="" max={FOLDER_NAME_MAX} label="Folder name" onDone={(v) => void createFolder(v)} />
                  </div>
                )}
                {folders.map(folderRow)}
                {folders.length === 0 && !creating && <p className="ciao-side__none ciao-side__none--quiet">Group chats by topic with &ldquo;+&rdquo;.</p>}
              </>
            )}
            <p className="ciao-side__label">Recent</p>
            {recent.length === 0 && loaded && <p className="ciao-side__none">{chats.length ? 'Every chat is in a folder.' : 'Your chats will show here.'}</p>}
            {recent.map((c) => chatRow(c))}
          </>
        )}
      </nav>

      {mounted && menu && menuBody && createPortal(
        <div
          ref={menuEl}
          className="ciao-menu"
          role="menu"
          aria-label={menu.kind === 'chat' ? 'Chat' : 'Folder'}
          style={{ left: menu.left, top: menu.top, bottom: menu.bottom, width: MENU_W }}
        >
          {menuBody}
        </div>,
        document.body,
      )}
    </>
  )
}
