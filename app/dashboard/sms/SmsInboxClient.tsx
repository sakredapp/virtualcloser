'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import type { SmsConversation, SmsMessage } from '@/lib/crmLeads'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDay(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const SESSION_LABEL: Record<string, string> = {
  context_confirmed: 'Context confirmed',
  discovery_in_progress: 'Discovery',
  discovery_complete: 'Discovery done',
  appointment_proposed: 'Appt proposed',
  appointment_booked: 'Appt booked',
  dormant: 'Dormant',
  escalated: 'Escalated',
  opted_out: 'Opted out',
}

const SESSION_COLOR: Record<string, string> = {
  appointment_booked: 'bg-green-50 text-green-700 border-green-200',
  appointment_proposed: 'bg-blue-50 text-blue-700 border-blue-200',
  escalated: 'bg-red-50 text-red-700 border-red-200',
  opted_out: 'bg-gray-100 text-gray-500 border-gray-200',
  dormant: 'bg-gray-100 text-gray-500 border-gray-200',
  discovery_complete: 'bg-purple-50 text-purple-700 border-purple-200',
}

type Thread = { lead: { id: string; name: string; phone: string | null }; messages: SmsMessage[] }

export default function SmsInboxClient({ conversations }: { conversations: SmsConversation[] }) {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    conversations[0]?.lead_id ?? null
  )
  const [thread, setThread] = useState<Thread | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)
  const [sending, setSending] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [search, setSearch] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const filtered = conversations.filter(c =>
    !search || c.lead_name.toLowerCase().includes(search.toLowerCase()) ||
    c.lead_phone?.includes(search) ||
    c.last_body.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    if (!selectedLeadId) return
    setLoadingThread(true)
    setThread(null)
    fetch(`/api/sms/thread?leadId=${selectedLeadId}`)
      .then(r => r.json())
      .then((data: Thread) => setThread(data))
      .catch(() => {})
      .finally(() => setLoadingThread(false))
  }, [selectedLeadId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread?.messages])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedLeadId || !draftText.trim() || sending) return
    setSending(true)
    const body = draftText.trim()
    setDraftText('')
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selectedLeadId, body }),
      })
      if (res.ok) {
        // Optimistic append
        const newMsg: SmsMessage = {
          id: crypto.randomUUID(),
          lead_id: selectedLeadId,
          direction: 'outbound',
          body,
          from_phone: '',
          to_phone: '',
          status: 'sent',
          is_ai_reply: false,
          created_at: new Date().toISOString(),
        }
        setThread(prev => prev ? { ...prev, messages: [...prev.messages, newMsg] } : prev)
      }
    } catch {}
    setSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(e as unknown as React.FormEvent)
    }
  }

  // Group messages by day for date separators
  function groupByDay(messages: SmsMessage[]) {
    const groups: { day: string; msgs: SmsMessage[] }[] = []
    for (const msg of messages) {
      const day = fmtDay(msg.created_at)
      const last = groups[groups.length - 1]
      if (last && last.day === day) last.msgs.push(msg)
      else groups.push({ day, msgs: [msg] })
    }
    return groups
  }

  const selectedConv = conversations.find(c => c.lead_id === selectedLeadId)

  return (
    <div className="flex h-[calc(100vh-120px)] gap-0 overflow-hidden rounded-2xl border border-gray-200 bg-white">

      {/* ── Left: conversation list ─────────────────────────────────────── */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-gray-100">
        <div className="p-3 border-b border-gray-100">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full text-sm bg-gray-50 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10 placeholder:text-gray-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">No conversations yet.</p>
          )}
          {filtered.map(conv => (
            <button
              key={conv.lead_id}
              onClick={() => setSelectedLeadId(conv.lead_id)}
              className={`w-full text-left px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                conv.lead_id === selectedLeadId ? 'bg-gray-100' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-0.5">
                <span className="text-sm font-medium text-gray-900 truncate">{conv.lead_name}</span>
                <span className="text-[11px] text-gray-400 flex-shrink-0">{timeAgo(conv.last_at)}</span>
              </div>
              <p className={`text-xs truncate mb-1 ${
                conv.last_direction === 'inbound' ? 'text-gray-700' : 'text-gray-400'
              }`}>
                {conv.last_direction === 'outbound' && <span className="text-gray-300">You: </span>}
                {conv.last_body}
              </p>
              <div className="flex items-center gap-1.5">
                {conv.session_state && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${SESSION_COLOR[conv.session_state] ?? 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                    {SESSION_LABEL[conv.session_state] ?? conv.session_state}
                  </span>
                )}
                {conv.ai_paused && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-orange-50 text-orange-600 border-orange-200">AI paused</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: thread ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedLeadId ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Select a conversation
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div>
                <p className="text-sm font-semibold text-gray-900">{selectedConv?.lead_name}</p>
                {selectedConv?.lead_phone && (
                  <p className="text-xs text-gray-400">{selectedConv.lead_phone}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedConv?.session_state && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${SESSION_COLOR[selectedConv.session_state] ?? 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                    {SESSION_LABEL[selectedConv.session_state] ?? selectedConv.session_state}
                  </span>
                )}
                {selectedLeadId && (
                  <Link
                    href={`/dashboard/prospects/${selectedLeadId}`}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    View prospect →
                  </Link>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
              {loadingThread && (
                <div className="flex items-center justify-center py-8">
                  <span className="text-sm text-gray-400">Loading…</span>
                </div>
              )}
              {!loadingThread && thread && thread.messages.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-8">No messages yet.</p>
              )}
              {!loadingThread && thread && groupByDay(thread.messages).map(({ day, msgs }) => (
                <div key={day}>
                  <div className="flex items-center gap-2 my-3">
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className="text-[11px] text-gray-400">{day}</span>
                    <div className="flex-1 h-px bg-gray-100" />
                  </div>
                  {msgs.map((msg, i) => {
                    const isOut = msg.direction === 'outbound'
                    const prevMsg = i > 0 ? msgs[i - 1] : null
                    const sameDir = prevMsg?.direction === msg.direction
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isOut ? 'justify-end' : 'justify-start'} ${sameDir ? 'mt-0.5' : 'mt-2'}`}
                      >
                        <div className={`max-w-[72%] group`}>
                          <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                            isOut
                              ? 'bg-gray-900 text-white rounded-br-sm'
                              : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                          }`}>
                            {msg.body}
                          </div>
                          <div className={`flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${isOut ? 'justify-end' : 'justify-start'}`}>
                            <span className="text-[10px] text-gray-400">{fmtTime(msg.created_at)}</span>
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
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Send box */}
            <form onSubmit={sendMessage} className="border-t border-gray-100 px-3 py-3 flex items-end gap-2">
              <textarea
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
                rows={2}
                className="flex-1 text-sm bg-gray-50 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10 resize-none placeholder:text-gray-400"
              />
              <button
                type="submit"
                disabled={!draftText.trim() || sending}
                className="flex-shrink-0 bg-gray-900 text-white text-sm px-4 py-2 rounded-xl hover:bg-gray-800 disabled:opacity-40 h-[42px]"
              >
                {sending ? '…' : 'Send'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
