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
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { MiraOrb } from '@/app/components/mira/MiraOrb'
import Markdown from '@/app/components/cxo/Markdown'
import DailyQueueReport from '@/app/components/cxo/DailyQueueReport'
import { useDictation } from '@/app/components/mira/useDictation'
import { useAssistantName } from '@/app/components/AssistantNameProvider'
import { isRunQueueText, type QueueReport } from '@/lib/mira/dailyQueueShared'
import './ciao-chat.css'

type Msg = { id: string; role: 'user' | 'assistant'; content: string; error?: boolean; queue?: QueueReport }
type Choice = { prompt: string; options: Array<{ label: string; value: string }> }
type Chat = { id: string; last_at: string; title: string }

const MAX_FIELD_PX = 200

let seq = 0
const nextId = () => `cc${Date.now().toString(36)}${(seq++).toString(36)}`
const toMsgs = (rows: Array<{ role: 'user' | 'assistant'; content: string }> | undefined): Msg[] =>
  (rows ?? []).filter((m) => m.content && (m.role === 'user' || m.role === 'assistant')).map((m) => ({ id: nextId(), role: m.role, content: m.content }))

function when(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days < 1) return 'Today'
  if (days < 2) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'long' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '·'
}

const Icon = {
  plus: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>,
  menu: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" /></svg>,
  close: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>,
  send: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" /></svg>,
  mic: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" /></svg>,
  stop: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" /></svg>,
}

export default function CiaoChat({ firstName, userName, userEmail, starters }: { firstName?: string; userName: string; userEmail: string; starters: string[] }) {
  const assistantName = useAssistantName()
  const router = useRouter()
  const [chats, setChats] = useState<Chat[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  /** A past chat open read-only; null = the current conversation. */
  const [viewing, setViewing] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [choice, setChoice] = useState<Choice | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [typed, setTyped] = useState('')
  const [drawer, setDrawer] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const newChatPending = useRef<Promise<unknown> | null>(null)

  const dictation = useDictation(useCallback((text: string) => setTyped(text), []))
  const listening = dictation.supported && dictation.listening

  const loadList = useCallback(async () => {
    const j = (await fetch('/api/mira/ask?list=1', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { chats?: Chat[]; current_id?: string | null } | null
    if (!j) return
    setChats(j.chats ?? [])
    setCurrentId(j.current_id ?? null)
  }, [])

  const loadCurrent = useCallback(async () => {
    const j = (await fetch('/api/mira/ask', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> } | null
    setMessages(toMsgs(j?.messages))
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
    <div className="ciao" data-drawer={drawer || undefined}>
      {drawer && <div className="ciao-scrim" aria-hidden onClick={() => setDrawer(false)} />}
      <aside className="ciao-side" aria-label="Chats">
        <div className="ciao-side__head">
          <button type="button" className="ciao-new" onClick={newChat} disabled={busy}>
            {Icon.plus}<span>New chat</span>
          </button>
          <button type="button" className="ciao-icon ciao-side__close" onClick={() => setDrawer(false)} aria-label="Close chats">{Icon.close}</button>
        </div>
        <p className="ciao-side__label">Recent</p>
        <nav className="ciao-side__list">
          {chats.length === 0 && loaded && <p className="ciao-side__none">Your chats will show here.</p>}
          {chats.map((c) => {
            const active = viewing ? viewing === c.id : c.id === currentId && messages.length > 0
            return (
              <button key={c.id} type="button" className="ciao-chat" aria-current={active || undefined} onClick={() => void openChat(c.id)} title={c.title}>
                <span className="ciao-chat__title">{c.title}</span>
                <span className="ciao-chat__when">{when(c.last_at)}</span>
              </button>
            )
          })}
        </nav>
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
          <button type="button" className="ciao-icon" onClick={() => setDrawer(true)} aria-label="Show chats">{Icon.menu}</button>
          <span className="ciao-top__name">{assistantName}</span>
          <button type="button" className="ciao-icon" onClick={newChat} disabled={busy} aria-label="New chat">{Icon.plus}</button>
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
                    : <div key={m.id} className="ciao-msg ciao-msg--ciao" data-error={m.error ? '' : undefined}><Markdown text={m.content} /></div>,
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
