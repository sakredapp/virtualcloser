'use client'

import { useState } from 'react'

type Props = {
  botUsername: string | null
  linkCode: string | null
  telegramLinked: boolean
  firstName?: string
}

const SECTION_LABEL: React.CSSProperties = {
  margin: '0 0 0.35rem', fontSize: '0.7rem', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)',
}

const TABS: Array<[string, string]> = [
  ['Command Center', 'Your daily home — top priorities, the day’s numbers, and what needs you.'],
  ['Pipeline', 'Deals and where each one stands.'],
  ['Projects', 'Plans and to-dos, AI-assisted.'],
  ['Inbox', 'Your email. Use the switcher up top to flip between your inbox and Spencer’s; reply right here.'],
  ['Calendar', 'Your Google Calendar — same switcher to view either calendar.'],
  ['Reports', 'The numbers and trends.'],
  ['Accounting', 'Deposits → carriers → commissions, plus your connected Google Sheets. This is your tab.'],
  ['Plaud', 'Voice recordings turned into a clean summary + action items.'],
]

/**
 * Bottom-left "Start here" guide. Explains the dashboard layout + how the
 * Telegram assistant works, and gives a one-tap link to connect Telegram.
 * Distinct from the bottom-right feedback button.
 */
export default function StartHereButton({ botUsername, linkCode, telegramLinked, firstName }: Props) {
  const [open, setOpen] = useState(false)
  const botUrl = botUsername ? `https://t.me/${botUsername}?start=${linkCode ?? ''}` : null

  return (
    <div style={{ position: 'fixed', left: 18, bottom: 18, zIndex: 50 }}>
      {open ? (
        <div
          style={{
            width: 360, maxWidth: 'calc(100vw - 36px)', maxHeight: '70vh', overflowY: 'auto',
            background: 'var(--paper, #fff)', border: '1px solid var(--border-soft)', borderRadius: 14,
            boxShadow: '0 12px 34px rgba(0,0,0,0.2)', padding: '1rem 1.1rem', color: 'var(--text)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <strong style={{ fontSize: 15 }}>Start here{firstName ? `, ${firstName}` : ''} 👋</strong>
            <button onClick={() => setOpen(false)} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, lineHeight: 1 }}>✕</button>
          </div>
          <p className="meta" style={{ fontSize: '0.85rem', margin: '0 0 0.9rem' }}>
            This is your executive workspace — everything for the business in one place. Quick tour:
          </p>

          <p style={SECTION_LABEL}>The tabs</p>
          <ul style={{ listStyle: 'none', margin: '0 0 1rem', padding: 0, display: 'grid', gap: '0.5rem' }}>
            {TABS.map(([name, desc]) => (
              <li key={name} style={{ fontSize: '0.84rem', lineHeight: 1.45 }}>
                <strong>{name}</strong> — <span style={{ color: 'var(--muted)' }}>{desc}</span>
              </li>
            ))}
          </ul>

          <p style={SECTION_LABEL}>Your Telegram assistant</p>
          <p style={{ fontSize: '0.84rem', lineHeight: 1.5, margin: '0 0 0.6rem' }}>
            Text the assistant to ask anything — your day, yesterday’s numbers, “draft a note to…” — and it logs
            meetings, reminders and tasks straight into here. <strong>You and Spencer share the same assistant</strong>,
            so it keeps you both coordinated automatically.
          </p>
          {telegramLinked ? (
            <p style={{ fontSize: '0.84rem', color: 'var(--signal-ok, #16a34a)', fontWeight: 600, margin: 0 }}>✓ Your Telegram is connected.</p>
          ) : botUrl ? (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <a
                href={botUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', textAlign: 'center', background: 'var(--ink)', color: 'var(--text-inv, #fff)', padding: '9px 16px', borderRadius: 999, fontWeight: 700, fontSize: 13.5, textDecoration: 'none' }}
              >
                Connect Telegram →
              </a>
              <p className="meta" style={{ fontSize: '0.78rem', margin: 0 }}>
                Tap <strong>Start</strong> in Telegram, then send{' '}
                <code style={{ background: 'var(--paper-2)', padding: '1px 5px', borderRadius: 5 }}>/link {linkCode ?? 'YOURCODE'}</code>.
              </p>
            </div>
          ) : (
            <p className="meta" style={{ fontSize: '0.8rem', margin: 0 }}>Ask your admin for the Telegram bot link.</p>
          )}

          <p className="meta" style={{ fontSize: '0.78rem', margin: '0.95rem 0 0', borderTop: '1px solid var(--border-soft)', paddingTop: '0.6rem' }}>
            Have an idea or hit a snag? Use the <strong>?</strong> at the bottom-right to send feedback anytime.
          </p>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="Start here — how to use this"
          title="Start here"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 14px',
            borderRadius: 999, border: '1px solid var(--border-soft)', background: 'var(--paper, #fff)',
            color: 'var(--text)', cursor: 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,0.16)',
            fontSize: 13.5, fontWeight: 700,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', background: 'var(--ink)', color: 'var(--text-inv, #fff)', fontSize: 13 }}>?</span>
          Start here
        </button>
      )}
    </div>
  )
}
