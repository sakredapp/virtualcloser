'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Prospect } from '@/lib/prospects'

type Message = { role: 'user' | 'assistant'; content: string }

const STARTERS = [
  'Generate setup checklist for selected features',
  'What should the Telegram bot do for them day-to-day?',
  'How complex is this build?',
  'What integrations make sense for them?',
  'Should they use iMessage or GHL?',
]

export default function ProspectChat({ prospect }: { prospect: Prospect }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim()
      if (!content || loading) return

      const userMsg: Message = { role: 'user', content }
      const next = [...messages, userMsg]

      setMessages([...next, { role: 'assistant', content: '' }])
      setInput('')
      setLoading(true)

      try {
        const res = await fetch('/api/admin/prospect-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prospectId: prospect.id, messages: next }),
        })

        if (!res.ok || !res.body) {
          throw new Error(`Request failed: ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let done = false

        while (!done) {
          const { value, done: doneReading } = await reader.read()
          done = doneReading
          if (value) {
            const chunk = decoder.decode(value, { stream: true })
            setMessages((prev) => [
              ...prev.slice(0, -1),
              { role: 'assistant', content: (prev.at(-1)?.content ?? '') + chunk },
            ])
          }
        }
      } catch {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: 'assistant', content: '⚠ Something went wrong. Please try again.' },
        ])
      } finally {
        setLoading(false)
        textareaRef.current?.focus()
      }
    },
    [input, loading, messages, prospect.id],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Starter prompts (shown when empty) */}
      {!hasMessages && (
        <div style={{ marginBottom: '1rem' }}>
          <p
            style={{
              margin: '0 0 0.75rem',
              fontSize: '13px',
              color: 'var(--muted)',
              lineHeight: 1.55,
            }}
          >
            Chat with Claude to ideate the perfect build for{' '}
            <strong style={{ color: 'var(--ink)' }}>
              {prospect.name ?? prospect.email ?? 'this prospect'}
            </strong>
            . Their notes, brief, and plan are included automatically.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                style={{
                  padding: '5px 13px',
                  background: 'var(--paper-2)',
                  border: '1px solid var(--border-soft)',
                  borderRadius: '999px',
                  fontSize: '12px',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message thread */}
      {hasMessages && (
        <div
          style={{
            maxHeight: '480px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
            paddingBottom: '0.75rem',
            marginBottom: '0.75rem',
          }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '86%',
                  padding: '0.6rem 0.85rem',
                  borderRadius:
                    m.role === 'user'
                      ? '14px 14px 4px 14px'
                      : '14px 14px 14px 4px',
                  background:
                    m.role === 'user' ? 'var(--red)' : 'var(--paper-2)',
                  color: m.role === 'user' ? '#fff' : 'var(--ink)',
                  fontSize: '13px',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {m.content ||
                  (loading && i === messages.length - 1 ? (
                    <span
                      style={{
                        display: 'inline-block',
                        width: '8px',
                        height: '14px',
                        background: 'var(--muted)',
                        borderRadius: '2px',
                        animation: 'blink 1s step-end infinite',
                      }}
                    />
                  ) : (
                    ''
                  ))}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input row */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'flex-end',
          borderTop: hasMessages ? '1px solid var(--border-soft)' : 'none',
          paddingTop: hasMessages ? '0.75rem' : '0',
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Ask about integrations, build scope, onboarding steps…  (Enter to send, Shift+Enter for newline)"
          disabled={loading}
          style={{
            flex: 1,
            padding: '0.6rem 0.75rem',
            border: '1px solid var(--border-soft)',
            borderRadius: '8px',
            fontSize: '13px',
            resize: 'none',
            fontFamily: 'inherit',
            color: 'var(--ink)',
            background: 'var(--paper)',
            lineHeight: 1.45,
            opacity: loading ? 0.6 : 1,
          }}
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          style={{
            padding: '0.6rem 1.1rem',
            background: loading || !input.trim() ? 'var(--ink-soft)' : 'var(--red)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: loading || !input.trim() ? 'default' : 'pointer',
            fontFamily: 'inherit',
            alignSelf: 'flex-end',
            minWidth: '64px',
            transition: 'background 0.15s',
          }}
        >
          {loading ? '…' : 'Send'}
        </button>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
