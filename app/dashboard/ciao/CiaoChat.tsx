'use client'

/**
 * The Ciao screen (owner 2026-10-19: "as clean as the Claude / Le Chat chat
 * window"). Thin left list (New chat, past chats, you at the bottom), and one
 * column: a greeting with one big box and three starters when empty, then the
 * conversation, your words as soft bubbles on the right and Ciao's answers as
 * plain text on the left.
 *
 * Same server as the bar at the foot of every page (MiraBar): POST
 * /api/mira/ask runs the turn (role scoping, approvals and the daily queue all
 * live there), GET reads the current conversation, GET ?list=1 the past chats
 * and GET ?conversation=<id> one past chat, read-only. A question asked while
 * a past chat is open goes to the current conversation, as everywhere else.
 *
 * The list (search, folders, pin, rename, delete) is ChatList.tsx and saves
 * through POST /api/mira/chats (owner 2026-10-20). Each answer has a quiet
 * Copy under it (Perplexity's action row), on hover, always on touch.
 *
 * One left column (owner 2026-10-20): the dashboard's rail is not drawn here
 * (DashboardShell's focus pages), so the list's top is "← Overview". On a
 * desktop the list folds to a slim strip (toggle, new chat, Overview) behind
 * the panel button, like ChatGPT's and Claude's sidebar toggle; the choice is
 * kept per browser. Phone and narrow windows keep the drawer.
 *
 * Text size (owner 2026-10-20: answers too big, too little fits; some people
 * need it bigger). The default is 15px; "Aa" left of the mic opens three steps
 * (Small 0.875x, Default, Large 1.15x), kept per browser. The thread scales
 * from one variable, --ciao-text-scale. References (Mobbin): Apple Books'
 * small A / big A segmented control and Grok's
 * chip beside the mic.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MiraOrb } from '@/app/components/mira/MiraOrb'
import Markdown from '@/app/components/cxo/Markdown'
import DailyQueueReport from '@/app/components/cxo/DailyQueueReport'
import { useDictation } from '@/app/components/mira/useDictation'
import { useAssistantName } from '@/app/components/AssistantNameProvider'
import { isRunQueueText, type QueueReport } from '@/lib/mira/dailyQueueShared'
import ChatList, { type Chat, type Folder, type RunOrganize } from './ChatList'
import './ciao-chat.css'

type Msg = { id: string; role: 'user' | 'assistant'; content: string; error?: boolean; queue?: QueueReport }
type Choice = { prompt: string; options: Array<{ label: string; value: string }> }

const MAX_FIELD_PX = 200
/** Per-browser: the chat list folded to its strip on a desktop. */
const COLLAPSED_KEY = 'cx:ciao_list_collapsed'
/** Per-browser: the chat text size step. */
const TEXT_SIZE_KEY = 'cx:ciao_text_size'
const TEXT_SIZES = [
  { id: 'small', label: 'Small', scale: 0.875 },
  { id: 'default', label: 'Default', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.15 },
] as const
type TextSize = (typeof TEXT_SIZES)[number]['id']
const isTextSize = (v: unknown): v is TextSize => TEXT_SIZES.some((t) => t.id === v)

let seq = 0
const nextId = () => `cc${Date.now().toString(36)}${(seq++).toString(36)}`
const toMsgs = (rows: Array<{ role: 'user' | 'assistant'; content: string }> | undefined): Msg[] =>
  (rows ?? []).filter((m) => m.content && (m.role === 'user' || m.role === 'assistant')).map((m) => ({ id: nextId(), role: m.role, content: m.content }))

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '·'
}

const Icon = {
  back: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>,
  plus: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>,
  menu: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" /></svg>,
  panel: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2.75" width="12" height="10.5" rx="2" /><path d="M6.25 2.75v10.5" /></svg>,
  home: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.75 7.25 8 3l5.25 4.25V13a.75.75 0 0 1-.75.75H9.75V10h-3.5v3.75H3.5a.75.75 0 0 1-.75-.75z" /></svg>,
  close: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>,
  send: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" /></svg>,
  mic: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" /></svg>,
  stop: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" /></svg>,
  copy: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.75" /><path d="M3.5 10.5V4a1.5 1.5 0 0 1 1.5-1.5h5.5" /></svg>,
  check: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-6.5" /></svg>,
}

/**
 * "Aa" beside the mic: a small popover of three steps (Apple Books' A | A).
 * Arrow keys move between steps, Escape or a click outside closes it.
 */
function TextSizeControl({ size, onChange }: { size: TextSize; onChange: (s: TextSize) => void }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const current = TEXT_SIZES.find((t) => t.id === size) ?? TEXT_SIZES[1]

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    // Focus the chosen step so the arrows work straight away.
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onGroupKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = TEXT_SIZES.findIndex((t) => t.id === size)
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(TEXT_SIZES.length - 1, i + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, i - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TEXT_SIZES.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(TEXT_SIZES[next].id)
    requestAnimationFrame(() => wrap.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus())
  }

  return (
    <span className="ciao-size" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="ciao-icon ciao-size__btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Text size: ${current.label}`}
        title={`Text size: ${current.label}`}
        data-size={size}
      >
        <span aria-hidden="true"><span className="ciao-size__a ciao-size__a--s">A</span><span className="ciao-size__a">a</span></span>
      </button>
      {open && (
        <div className="ciao-size__pop" role="dialog" aria-label="Text size">
          <span className="ciao-size__title">Text size</span>
          <div className="ciao-size__seg" role="radiogroup" aria-label="Text size" onKeyDown={onGroupKey}>
            {TEXT_SIZES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === size}
                tabIndex={t.id === size ? 0 : -1}
                className="ciao-size__opt"
                data-step={t.id}
                onClick={() => onChange(t.id)}
              >
                <span className="ciao-size__glyph" aria-hidden="true">A</span>
                <span className="ciao-size__label">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  )
}

/** The quiet action row under one answer: Copy (the answer as written). */
function AnswerActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <div className="ciao-acts">
      <button
        type="button"
        className="ciao-act"
        onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}
        aria-label={copied ? 'Copied' : 'Copy answer'}
        title={copied ? 'Copied' : 'Copy'}
      >
        {copied ? Icon.check : Icon.copy}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  )
}

export default function CiaoChat({ firstName, userName, userEmail, starters }: { firstName?: string; userName: string; userEmail: string; starters: string[] }) {
  const assistantName = useAssistantName()
  const router = useRouter()
  const [chats, setChats] = useState<Chat[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  /** Folders, pin, rename and delete are on (the migration has run). */
  const [organize, setOrganize] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  /** A past chat open read-only; null = the current conversation. */
  const [viewing, setViewing] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [choice, setChoice] = useState<Choice | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [typed, setTyped] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [textSize, setTextSize] = useState<TextSize>('default')
  const field = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const newChatPending = useRef<Promise<unknown> | null>(null)

  const dictation = useDictation(useCallback((text: string) => setTyped(text), []))
  const listening = dictation.supported && dictation.listening

  const loadList = useCallback(async () => {
    const j = (await fetch('/api/mira/ask?list=1', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { chats?: Chat[]; folders?: Folder[]; organize?: boolean; current_id?: string | null } | null
    if (!j) return
    setChats(j.chats ?? [])
    setFolders(j.folders ?? [])
    setOrganize(j.organize === true)
    setCurrentId(j.current_id ?? null)
  }, [])

  const loadCurrent = useCallback(async () => {
    const j = (await fetch('/api/mira/ask', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> } | null
    setMessages(toMsgs(j?.messages))
  }, [])

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1') } catch { /* blocked */ }
  }, [])
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TEXT_SIZE_KEY)
      if (isTextSize(saved)) setTextSize(saved)
    } catch { /* blocked */ }
  }, [])
  const chooseTextSize = useCallback((next: TextSize) => {
    setTextSize(next)
    try { localStorage.setItem(TEXT_SIZE_KEY, next) } catch { /* blocked */ }
  }, [])
  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      const next = !v
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch { /* blocked */ }
      return next
    })
  }, [])

  useEffect(() => {
    void Promise.all([loadCurrent(), loadList()]).finally(() => setLoaded(true))
  }, [loadCurrent, loadList])

  // Keep the newest turn in view.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy, choice])

  // The field grows with what is typed, then scrolls.
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_PX)}px`
    el.style.overflowY = el.scrollHeight > MAX_FIELD_PX ? 'auto' : 'hidden'
  }, [typed, messages.length])

  const push = useCallback((m: Omit<Msg, 'id'>) => setMessages((cur) => [...cur, { id: nextId(), ...m }]), [])

  const ask = useCallback(async (text: string, display?: string) => {
    const shown = (display ?? text).trim()
    if (!shown || busy) return
    setBusy(true)
    setChoice(null)
    setDrawer(false)
    // Asked from a past chat: it goes to the current conversation, so show that one.
    if (viewing) {
      setViewing(null)
      await loadCurrent()
    }
    push({ role: 'user', content: shown })
    try {
      if (newChatPending.current) await newChatPending.current
      const r = await fetch('/api/mira/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), display: display ?? undefined }),
      })
      if (r.status === 401) {
        push({ role: 'assistant', content: `Sign in again to ask ${assistantName}.`, error: true })
        return
      }
      const j = (await r.json().catch(() => null)) as { reply?: string; choice?: Choice; error?: string; queue?: QueueReport; new_conversation?: boolean } | null
      const reply = (j?.reply ?? '').trim()
      if (!r.ok || !j) {
        push({ role: 'assistant', content: reply || 'Something hiccuped on my end. Ask me that again in a moment.', error: true })
        return
      }
      // Two hours idle: the server started a fresh conversation; show only this question.
      if (j.new_conversation) setMessages((cur) => cur.slice(-1))
      if (j.queue) {
        push({ role: 'assistant', content: reply, queue: j.queue })
        router.refresh()
      } else if (reply) push({ role: 'assistant', content: reply, error: Boolean(j.error) })
      else if (j.error) push({ role: 'assistant', content: String(j.error), error: true })
      if (j.choice && Array.isArray(j.choice.options) && j.choice.options.length > 0) setChoice(j.choice)
    } catch {
      push({ role: 'assistant', content: `Couldn't reach ${assistantName} just now. Check your connection and try again.`, error: true })
    } finally {
      setBusy(false)
      void loadList()
    }
  }, [busy, viewing, loadCurrent, push, router, assistantName, loadList])

  // "New chat": a fresh conversation. The old one stays saved and listed.
  const newChat = useCallback(() => {
    if (busy) return
    setMessages([])
    setChoice(null)
    setViewing(null)
    setDrawer(false)
    const p = fetch('/api/mira/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_chat: true }) }).catch(() => {})
    newChatPending.current = p
    void p.finally(() => {
      if (newChatPending.current === p) newChatPending.current = null
      void loadList()
    })
    requestAnimationFrame(() => field.current?.focus())
  }, [busy, loadList])

  const openChat = useCallback(async (id: string) => {
    if (busy) return
    setDrawer(false)
    setChoice(null)
    if (id === currentId) {
      setViewing(null)
      await loadCurrent()
      return
    }
    setViewing(id)
    const j = (await fetch(`/api/mira/ask?conversation=${encodeURIComponent(id)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> } | null
    setMessages(toMsgs(j?.messages))
  }, [busy, currentId, loadCurrent])

  // One list change (ChatList is already showing it). A failure puts the list
  // back from the server and says why in one line under the list.
  const run: RunOrganize = useCallback(async (body) => {
    setNotice(null)
    const r = await fetch('/api/mira/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const j = (r ? await r.json().catch(() => null) : null) as { ok?: boolean; message?: string; folder?: Folder; new_chat?: boolean } | null
    if (!r || !r.ok || !j?.ok) {
      setNotice(j?.message ?? 'That did not save. Check your connection and try again.')
      void loadList()
      return null
    }
    if (body.action === 'delete_chat') {
      // The open chat was deleted: show the fresh current one instead.
      if (j.new_chat || viewing === body.id) {
        setViewing(null)
        setChoice(null)
        if (j.new_chat) setMessages([])
        else await loadCurrent()
      }
      void loadList()
    }
    return { ok: true, folder: j.folder }
  }, [loadList, loadCurrent, viewing])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const isActive = useCallback((id: string) => (viewing ? viewing === id : id === currentId && messages.length > 0), [viewing, currentId, messages.length])

  // The rest of the app hands Ciao a question ("Ask Ciao" buttons, the phone orb).
  const askRef = useRef(ask)
  askRef.current = ask
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text?.trim()
      if (text) void askRef.current(text)
    }
    const onFocus = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text
      if (typeof text === 'string') setTyped(text)
      requestAnimationFrame(() => field.current?.focus())
    }
    window.addEventListener('mira:ask', onAsk)
    window.addEventListener('mira:focus', onFocus)
    return () => {
      window.removeEventListener('mira:ask', onAsk)
      window.removeEventListener('mira:focus', onFocus)
    }
  }, [])

  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawer])

  const sendTyped = () => {
    const text = typed.trim()
    if (!text || busy) return
    setTyped('')
    if (dictation.supported) dictation.reset()
    void ask(text)
  }
  const onSubmit = (e: FormEvent) => { e.preventDefault(); sendTyped() }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      sendTyped()
    }
  }

  const empty = loaded && messages.length === 0 && !busy && !viewing
  const runningQueue = busy && messages.length > 0 && isRunQueueText(messages[messages.length - 1]?.content ?? '')

  const composer = (
    <form className="ciao-box" onSubmit={onSubmit} data-listening={listening || undefined}>
      <textarea
        ref={field}
        className="ciao-box__field"
        rows={1}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={listening ? 'Listening. Just say it.' : viewing ? `Ask ${assistantName} (goes to your current chat)` : `Ask ${assistantName} anything`}
        aria-label={`Message ${assistantName}`}
        autoComplete="off"
        enterKeyHint="send"
        autoFocus
      />
      <div className="ciao-box__tools">
        {dictation.error && <span className="ciao-box__note" role="status">{dictation.error}</span>}
        <TextSizeControl size={textSize} onChange={chooseTextSize} />
        {dictation.supported && (
          <button type="button" className="ciao-icon" onClick={() => dictation.toggle()} aria-pressed={listening} aria-label={listening ? 'Stop listening' : `Talk to ${assistantName}`} title={listening ? 'Stop' : 'Dictate'}>
            {listening ? Icon.stop : Icon.mic}
          </button>
        )}
        <button type="submit" className="ciao-send" disabled={!typed.trim() || busy} aria-label={`Send to ${assistantName}`}>
          {Icon.send}
        </button>
      </div>
    </form>
  )

  return (
    <div
      className="ciao"
      data-drawer={drawer || undefined}
      data-collapsed={collapsed || undefined}
      data-text-size={textSize}
      style={{ '--ciao-text-scale': String(TEXT_SIZES.find((t) => t.id === textSize)?.scale ?? 1) } as CSSProperties}
    >
      {drawer && <div className="ciao-scrim" aria-hidden onClick={() => setDrawer(false)} />}
      <aside className="ciao-side" aria-label="Chats">
        {/* Desktop, folded: the slim strip (Claude's collapsed rail). */}
        <div className="ciao-strip">
          <button type="button" className="ciao-icon" onClick={toggleCollapsed} aria-label="Show chats" aria-expanded={false} title="Show chats">{Icon.panel}</button>
          <button type="button" className="ciao-icon" onClick={newChat} disabled={busy} aria-label="New chat" title="New chat">{Icon.plus}</button>
          <Link href="/dashboard" className="ciao-icon" aria-label="Back to Overview" title="Overview">{Icon.home}</Link>
          <span className="ciao-me__avatar ciao-strip__me" title={userName} aria-hidden>{initials(userName)}</span>
        </div>
        <div className="ciao-side__top">
          <Link href="/dashboard" className="ciao-back">{Icon.back}<span>Overview</span></Link>
          <button type="button" className="ciao-icon ciao-side__fold" onClick={toggleCollapsed} aria-label="Hide chats" aria-expanded title="Hide chats">{Icon.panel}</button>
        </div>
        <div className="ciao-side__head">
          <button type="button" className="ciao-new" onClick={newChat} disabled={busy}>
            {Icon.plus}<span>New chat</span>
          </button>
          <button type="button" className="ciao-icon ciao-side__close" onClick={() => setDrawer(false)} aria-label="Close chats">{Icon.close}</button>
        </div>
        <ChatList
          chats={chats}
          folders={folders}
          organize={organize}
          loaded={loaded}
          isActive={isActive}
          onOpen={(id) => void openChat(id)}
          setChats={setChats}
          setFolders={setFolders}
          run={run}
        />
        {notice && <p className="ciao-notice" role="status">{notice}</p>}
        <div className="ciao-me">
          <span className="ciao-me__avatar" aria-hidden>{initials(userName)}</span>
          <span className="ciao-me__text">
            <span className="ciao-me__name">{userName}</span>
            <span className="ciao-me__mail">{userEmail}</span>
          </span>
        </div>
      </aside>

      <section className="ciao-main" aria-label={assistantName}>
        <header className="ciao-top">
          <span className="ciao-top__side">
            <Link href="/dashboard" className="ciao-icon" aria-label="Back to Overview">{Icon.back}</Link>
            <button type="button" className="ciao-icon" onClick={() => setDrawer(true)} aria-label="Show chats">{Icon.menu}</button>
          </span>
          <span className="ciao-top__name">{assistantName}</span>
          <span className="ciao-top__side ciao-top__side--end">
            <button type="button" className="ciao-icon" onClick={newChat} disabled={busy} aria-label="New chat">{Icon.plus}</button>
          </span>
        </header>

        {empty ? (
          <div className="ciao-hello">
            <span className="ciao-hello__mark"><MiraOrb size={52} decorative state="idle" /></span>
            <h1 className="ciao-hello__title">Hi{firstName ? ` ${firstName}` : ''}, what do you need?</h1>
            {composer}
            {starters.length > 0 && (
              <div className="ciao-starters" role="group" aria-label="Suggestions">
                {starters.slice(0, 3).map((q) => (
                  <button key={q} type="button" className="ciao-starter" onClick={() => void ask(q)}>{q}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="ciao-thread" ref={scroller} aria-live="polite">
              <div className="ciao-col">
                {viewing && <p className="ciao-past">A past chat. Ask below to carry on in your current one.</p>}
                {messages.map((m) => m.role === 'user'
                  ? <div key={m.id} className="ciao-msg ciao-msg--me">{m.content}</div>
                  : m.queue
                    ? <div key={m.id} className="ciao-msg ciao-msg--ciao"><DailyQueueReport report={m.queue} onChange={() => router.refresh()} /></div>
                    : m.error
                      ? <div key={m.id} className="ciao-msg ciao-msg--ciao" data-error=""><Markdown text={m.content} /></div>
                      : (
                        <div key={m.id} className="ciao-msg ciao-msg--ciao">
                          <Markdown text={m.content} />
                          <AnswerActions text={m.content} />
                        </div>
                      ),
                )}
                {busy && (
                  <div className="ciao-thinking" role="status">
                    <MiraOrb size={18} decorative state="thinking" />
                    <span>{runningQueue ? 'Working your queue…' : `${assistantName} is thinking…`}</span>
                  </div>
                )}
                {choice && !busy && (
                  <div className="ciao-starters ciao-starters--choice" role="group" aria-label={choice.prompt}>
                    {choice.options.map((o) => (
                      <button key={`${o.value}|${o.label}`} type="button" className="ciao-starter" onClick={() => void ask(o.value, o.label)} title={o.label}>{o.label}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="ciao-foot">{composer}</div>
          </>
        )}
      </section>
    </div>
  )
}
