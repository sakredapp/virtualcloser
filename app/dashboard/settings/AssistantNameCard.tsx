'use client'
/**
 * Settings › Assistant name (owner 2026-10-17). The company's name for the AI
 * assistant (owner/admin) and a person's own name for it (anyone). A save
 * shows the new name at once (context) and refreshes the server-rendered text.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ASSISTANT_NAME, ASSISTANT_NAME_MAX } from '@/lib/assistantName'
import { useSetAssistantName } from '@/app/components/AssistantNameProvider'
import '../cxo-alerts.css'

export type AssistantNameView = { company: string | null; personal: string | null; resolved: string; canEditCompany: boolean }
type Scope = 'company' | 'personal'

export default function AssistantNameCard({ initial, showPersonal = true, endpoint = '/api/me/assistant-name' }: { initial: AssistantNameView; showPersonal?: boolean; endpoint?: string }) {
  const router = useRouter()
  const setShownName = useSetAssistantName()
  const [view, setView] = useState(initial)
  const [company, setCompany] = useState(initial.company ?? '')
  const [personal, setPersonal] = useState(initial.personal ?? '')
  const [busy, setBusy] = useState<Scope | null>(null)
  const [note, setNote] = useState<{ scope: Scope; tone: 'ok' | 'err'; text: string } | null>(null)
  const [explain, setExplain] = useState(false)

  async function save(scope: Scope, value: string) {
    setBusy(scope)
    setNote(null)
    try {
      const r = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope, name: value }) })
      const j = (await r.json().catch(() => ({}))) as Partial<AssistantNameView> & { error?: string }
      if (!r.ok || !j.resolved) throw new Error(j.error || 'Could not save that.')
      const next = j as AssistantNameView
      setView(next)
      setCompany(next.company ?? '')
      setPersonal(next.personal ?? '')
      setShownName(next.resolved)
      router.refresh()
      const saved = scope === 'company' ? next.company : next.personal
      setNote({
        scope,
        tone: 'ok',
        text: saved
          ? scope === 'company' ? `Saved. Your company's assistant is now ${saved}.` : `Saved. You'll see ${saved} everywhere.`
          : scope === 'company' ? `Cleared. Back to ${ASSISTANT_NAME}.` : `Cleared. You'll see ${next.resolved}, your company's name.`,
      })
    } catch (e) {
      setNote({ scope, tone: 'err', text: e instanceof Error ? e.message : 'Could not save that.' })
    } finally {
      setBusy(null)
    }
  }

  const companyShown = view.company ?? ASSISTANT_NAME
  const msg = (scope: Scope) =>
    note && note.scope === scope ? <p className={note.tone === 'err' ? 'cx-pref-err' : 'cx-int-status'} role="status" style={{ margin: '6px 0 0' }}>{note.text}</p> : null

  return (
    <section className="card cx-alerts-card" id="assistant-name" style={{ marginTop: '0.8rem' }}>
      <div className="section-head">
        <h2>Assistant name</h2>
        <p>what your AI assistant is called</p>
      </div>

      <div className="cx-pref-rows">
        {view.canEditCompany ? (
          <form className="cx-pref" style={{ display: 'grid', cursor: 'default' }} onSubmit={(e) => { e.preventDefault(); void save('company', company) }}>
            <span>
              <strong>Your company&rsquo;s assistant is called&hellip;</strong>
              <small>Everyone at your company sees this name, unless they pick their own. Leave it empty for {ASSISTANT_NAME}.</small>
            </span>
            <div className="cx-int-form" style={{ marginTop: 0 }}>
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder={ASSISTANT_NAME} maxLength={ASSISTANT_NAME_MAX} aria-label="Company assistant name" autoComplete="off" />
              <button type="submit" className="cx-btn cx-btn-sm" disabled={busy !== null || company.trim() === (view.company ?? '')}>{busy === 'company' ? 'Saving…' : 'Save'}</button>
            </div>
            {msg('company')}
          </form>
        ) : (
          <div className="cx-pref" style={{ cursor: 'default' }}>
            <span>
              <strong>Your company&rsquo;s assistant is called {companyShown}</strong>
              <small>The owner or an admin can change it.</small>
            </span>
          </div>
        )}

        {showPersonal && (
          <form className="cx-pref" style={{ display: 'grid', cursor: 'default' }} onSubmit={(e) => { e.preventDefault(); void save('personal', personal) }}>
            <span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong>Call it something else just for me</strong>
                <button
                  type="button"
                  onClick={() => setExplain((v) => !v)}
                  aria-expanded={explain}
                  aria-label="What does this change?"
                  title="What does this change?"
                  style={{ width: 22, height: 22, borderRadius: 999, border: '1px solid var(--cx-line-strong, rgba(15,15,15,0.2))', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}
                >
                  ⓘ
                </button>
              </span>
              <small>Optional. Leave it empty to use {companyShown}.</small>
              {explain && (
                <small>
                  Only you see this name: in the app, on your phone, in your emails and Slack messages, and when the assistant talks to you. Everyone else keeps
                  seeing {companyShown}. What it can do does not change.
                </small>
              )}
            </span>
            <div className="cx-int-form" style={{ marginTop: 0 }}>
              <input value={personal} onChange={(e) => setPersonal(e.target.value)} placeholder={companyShown} maxLength={ASSISTANT_NAME_MAX} aria-label="Your own assistant name" autoComplete="off" />
              <button type="submit" className="cx-btn cx-btn-sm" disabled={busy !== null || personal.trim() === (view.personal ?? '')}>{busy === 'personal' ? 'Saving…' : 'Save'}</button>
            </div>
            {msg('personal')}
          </form>
        )}
      </div>
    </section>
  )
}
