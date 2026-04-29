'use client'

import { useState } from 'react'
import type { AddonKey } from '@/lib/addons'

/**
 * BotInstructionsModal — replaces the inline `<details>` "show details"
 * block on the dashboard with a click-to-open dialog. Copy is tailored
 * to the rep's actual build: dialer / roleplay / CRM / messaging
 * sections only render if the matching add-on is active.
 *
 * Also surfaces the rep's Telegram link code + disconnect/regenerate
 * action inside the modal so we don't need a separate card on the
 * overview page.
 */
export default function BotInstructionsModal({
  botUsername,
  activeAddonKeys,
  linkCode,
  regenerateAction,
  variant = 'default',
}: {
  botUsername: string
  activeAddonKeys: AddonKey[]
  linkCode?: string | null
  /** Server action posted on "Disconnect & regenerate". */
  regenerateAction?: string | ((formData: FormData) => void | Promise<void>)
  /** `compact` strips the trigger down to a chip suitable for embedding
   *  in the hero corner; `default` is the wide bar shown on the dashboard. */
  variant?: 'default' | 'compact'
}) {
  const [open, setOpen] = useState(false)
  const active = new Set(activeAddonKeys)
  const hasDialer = active.has('addon_dialer_lite') || active.has('addon_dialer_pro')
  const hasRoleplay =
    active.has('addon_roleplay_lite') || active.has('addon_roleplay_pro')
  const hasCrm =
    active.has('addon_ghl_crm') ||
    active.has('addon_hubspot_crm') ||
    active.has('addon_pipedrive_crm') ||
    active.has('addon_salesforce_crm')
  const hasBb = active.has('addon_bluebubbles')
  const hasFathom = active.has('addon_fathom')

  return (
    <>
      {variant === 'compact' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Bot help — @${botUsername}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.4rem 0.7rem 0.4rem 0.55rem',
            background: 'rgba(255,255,255,0.14)',
            border: '1px solid rgba(255,255,255,0.45)',
            borderRadius: 999,
            color: '#fff',
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 999,
              background: '#fff',
              color: 'var(--red, #ff2800)',
              fontSize: 11,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            ⚑
          </span>
          <span style={{ opacity: 0.92 }}>@{botUsername}</span>
          <span
            aria-hidden
            style={{
              fontSize: '0.7rem',
              opacity: 0.85,
              borderLeft: '1px solid rgba(255,255,255,0.45)',
              paddingLeft: '0.45rem',
              marginLeft: '0.1rem',
            }}
          >
            How to use
          </span>
        </button>
      ) : (
        <div
          style={{
            marginTop: '0.8rem',
            background: 'var(--paper, #fff)',
            border: '1px solid var(--ink-soft, #e3ddd0)',
            borderRadius: 10,
            padding: '0.7rem 0.95rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.8rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <a
              href={`https://t.me/${botUsername}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--red, #ff2800)', fontWeight: 700, textDecoration: 'none' }}
            >
              @{botUsername}
            </a>
            <span style={{ color: 'var(--muted, #5a5a5a)', fontSize: '0.78rem' }}>
              connected
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn"
            style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}
          >
            How to use the bot
          </button>
        </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`How to use @${botUsername}`}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(15,15,15,0.55)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '6vh 1rem 2rem',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              background: 'var(--paper, #fff)',
              color: 'var(--ink, #0f0f0f)',
              borderRadius: 14,
              border: '1.5px solid var(--ink, #0f0f0f)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
              overflow: 'hidden',
            }}
          >
            <div style={{
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--line, #e6e1d8)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '1rem',
            }}>
              <div>
                <p style={{
                  fontSize: '0.7rem', letterSpacing: '0.18em',
                  textTransform: 'uppercase', fontWeight: 800,
                  color: 'var(--red, #ff2800)', margin: 0,
                }}>
                  Telegram bot
                </p>
                <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.2rem', color: 'var(--ink)' }}>
                  How to use @{botUsername}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  border: '1px solid var(--ink-soft, #e3ddd0)',
                  background: 'var(--paper, #fff)',
                  color: 'var(--ink)',
                  borderRadius: 999, width: 32, height: 32,
                  cursor: 'pointer', fontSize: 18, lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <div style={{
              padding: '0.85rem 1.25rem 1rem',
              display: 'grid', gap: '0.85rem',
              fontSize: '0.92rem', lineHeight: 1.5, color: 'var(--ink)',
            }}>
              <p style={{ margin: 0 }}>
                Talk to the bot like an assistant. Voice memos work too — it transcribes and acts on them.
              </p>

              <Section title="Daily flow">
                <Bullet>Morning briefing lands automatically — overdue tasks, today&rsquo;s leads, calendar.</Bullet>
                <Bullet>Midday pulse flags anything heating up or going cold.</Bullet>
                <Bullet>Drop a brain dump anytime: &ldquo;3 things tomorrow: call Dana, email Ben pricing, finish proposal&rdquo;</Bullet>
              </Section>

              <Section title="Lead + pipeline">
                <Bullet>&ldquo;New prospect Dana Kim at Acme, she&rsquo;s hot, follow up Thursday on pricing&rdquo;</Bullet>
                <Bullet>&ldquo;Just called Ben, he&rsquo;s warm, wants a demo next week&rdquo;</Bullet>
                <Bullet>&ldquo;Move Dana to Proposal stage&rdquo;</Bullet>
                <Bullet>&ldquo;Nina&rsquo;s gone dormant, dead deal&rdquo;</Bullet>
                <Bullet>&ldquo;What&rsquo;s overdue?&rdquo; · &ldquo;Mark all overdue done&rdquo; · &ldquo;Undo&rdquo;</Bullet>
              </Section>

              <Section title="Tasks + goals">
                <Bullet>&ldquo;Remind me Friday at 2pm to send Acme proposal&rdquo;</Bullet>
                <Bullet>&ldquo;Goal this month: close 10 deals&rdquo; · &ldquo;Q2 goal: $250K&rdquo;</Bullet>
                <Bullet>&ldquo;Mark #2 done&rdquo; (uses position from the last list shown)</Bullet>
              </Section>

              {hasDialer && (
                <Section title="AI Dialer (active)">
                  <Bullet>&ldquo;Dial my hot leads&rdquo; · &ldquo;Call Dana now&rdquo;</Bullet>
                  <Bullet>&ldquo;Pause outbound for the day&rdquo; — kills the queue, drains nothing.</Bullet>
                  <Bullet>Outcomes (confirmed / reschedule / no-answer) auto-tag in your CRM.</Bullet>
                </Section>
              )}

              {hasRoleplay && (
                <Section title="Roleplay (active)">
                  <Bullet>&ldquo;Roleplay objection handling for 15 minutes&rdquo;</Bullet>
                  <Bullet>&ldquo;Roleplay a CFO buyer for the Acme call tomorrow&rdquo;</Bullet>
                  <Bullet>Sessions are scored — review at /dashboard/roleplay.</Bullet>
                </Section>
              )}

              {hasCrm && (
                <Section title="CRM sync (active)">
                  <Bullet>Stage moves push to your CRM in real time — workflows fire automatically.</Bullet>
                  <Bullet>Inbound webhooks bring contact + tag + appointment events back here.</Bullet>
                  <Bullet>&ldquo;Sync now&rdquo; forces a full reconcile if something looks off.</Bullet>
                </Section>
              )}

              {hasBb && (
                <Section title="iMessage / BlueBubbles (active)">
                  <Bullet>&ldquo;Text Dana: confirming our 3pm tomorrow&rdquo; sends through your Mac.</Bullet>
                  <Bullet>Inbound iMessages route into your dashboard inbox.</Bullet>
                </Section>
              )}

              {hasFathom && (
                <Section title="Fathom recordings (active)">
                  <Bullet>Calls auto-summarize after the meeting; action items drop into your brain.</Bullet>
                  <Bullet>&ldquo;What did Dana say about pricing on the last call?&rdquo; pulls from transcripts.</Bullet>
                </Section>
              )}

              <Section title="Power moves">
                <Bullet>Reply with a voice memo — it&rsquo;s often faster than typing.</Bullet>
                <Bullet>&ldquo;Repeat that&rdquo; re-sends the bot&rsquo;s last reply.</Bullet>
                <Bullet>&ldquo;Help&rdquo; lists every command the bot understands right now.</Bullet>
              </Section>

              {(linkCode || regenerateAction) && (
                <section
                  style={{
                    marginTop: '0.4rem',
                    padding: '0.85rem 0.95rem',
                    border: '1px solid var(--ink-soft, #e3ddd0)',
                    borderRadius: 10,
                    background: 'var(--paper-2, #f7f4ef)',
                  }}
                >
                  <h3 style={{
                    margin: '0 0 0.45rem',
                    fontSize: '0.7rem', letterSpacing: '0.16em',
                    textTransform: 'uppercase', fontWeight: 800,
                    color: 'var(--red, #ff2800)',
                  }}>
                    Your link code
                  </h3>
                  <p style={{ margin: '0 0 0.55rem', fontSize: '0.82rem', color: 'var(--muted)' }}>
                    Save this in case you ever need to relink. Send <code style={{ background: 'var(--paper)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--ink-soft)' }}>/link {linkCode ?? '—'}</code> to @{botUsername} from a fresh Telegram account to reconnect.
                  </p>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
                    marginBottom: regenerateAction ? '0.7rem' : 0,
                  }}>
                    <code style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: '0.92rem', fontWeight: 700,
                      background: 'var(--paper)', color: 'var(--ink)',
                      padding: '0.4rem 0.7rem', borderRadius: 6,
                      border: '1px solid var(--ink-soft)',
                      letterSpacing: '0.06em',
                    }}>
                      {linkCode ?? '—'}
                    </code>
                  </div>
                  {regenerateAction && (
                    <form
                      action={regenerateAction}
                      onSubmit={(e) => {
                        if (!confirm('This disconnects your Telegram and gives you a fresh code. Continue?')) {
                          e.preventDefault()
                        }
                      }}
                      style={{ margin: 0 }}
                    >
                      <button
                        type="submit"
                        className="btn dismiss"
                        style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem' }}
                      >
                        Disconnect &amp; regenerate code
                      </button>
                      <span style={{ marginLeft: '0.6rem', fontSize: '0.72rem', color: 'var(--muted)' }}>
                        Use only if you switched Telegram accounts or someone got the old code.
                      </span>
                    </form>
                  )}
                </section>
              )}
            </div>

            <div style={{
              padding: '0.75rem 1.25rem',
              borderTop: '1px solid var(--line, #e6e1d8)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: '0.8rem', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted, #5a5a5a)' }}>
                Open Telegram and try one of these.
              </span>
              <a
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noreferrer"
                className="btn approve"
                style={{ padding: '0.45rem 0.95rem', fontSize: '0.85rem', textDecoration: 'none' }}
              >
                Open @{botUsername} →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 style={{
        margin: '0 0 0.4rem',
        fontSize: '0.7rem', letterSpacing: '0.16em',
        textTransform: 'uppercase', fontWeight: 800,
        color: 'var(--red, #ff2800)',
      }}>
        {title}
      </h3>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.3rem' }}>
        {children}
      </ul>
    </section>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li style={{
      display: 'flex', gap: '0.5rem', alignItems: 'baseline',
      fontSize: '0.88rem', color: 'var(--ink)',
    }}>
      <span aria-hidden style={{ color: 'var(--red, #ff2800)', fontSize: '0.65rem' }}>▶</span>
      <span>{children}</span>
    </li>
  )
}
