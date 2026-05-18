'use client'

import { useState } from 'react'

export type DirectoryOption = { email: string; name: string }

export type PlaudActionRowProps = {
  id: string
  kind:
    | 'create_task'
    | 'create_doc'
    | 'update_sheet'
    | 'send_email'
    | 'create_calendar_event'
    | 'notify_member'
  status: 'pending' | 'approved' | 'executed' | 'failed' | 'dismissed' | 'superseded'
  payload: Record<string, unknown>
  target_email: string | null
  target_display_name: string | null
  recipient_unresolved: string | null
  result: Record<string, unknown> | null
  error: string | null
  auto_executed: boolean
  reasoning: string | null
  directoryOptions?: DirectoryOption[]
}

const KIND_LABEL: Record<PlaudActionRowProps['kind'], string> = {
  create_task: 'Task',
  create_doc: 'Doc',
  update_sheet: 'Sheet update',
  send_email: 'Email',
  create_calendar_event: 'Calendar event',
  notify_member: 'Internal note',
}

const PEOPLE_TOUCHING = new Set(['send_email', 'create_calendar_event'])

export default function PlaudActionRow(props: PlaudActionRowProps) {
  const [status, setStatus] = useState(props.status)
  const [error, setError] = useState<string | null>(props.error)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({
    subject: String(props.payload.subject ?? ''),
    body: String(props.payload.body ?? ''),
    title: String(props.payload.title ?? ''),
    start_iso: String(props.payload.start_iso ?? ''),
    end_iso: String(props.payload.end_iso ?? ''),
    recipient_email: props.target_email ?? '',
  })

  const showApprove =
    PEOPLE_TOUCHING.has(props.kind) && status === 'pending' && !props.recipient_unresolved
  const showRetry = status === 'failed'
  const showDismiss = status === 'pending' || status === 'failed'
  const isDone = status === 'executed'
  const isDismissed = status === 'dismissed'

  async function approve() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/plaud/actions/${props.id}/approve`, { method: 'POST' })
    setBusy(false)
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (json.ok) setStatus('executed')
    else setError(json.error ?? 'failed')
  }

  async function dismiss() {
    setBusy(true)
    const res = await fetch(`/api/plaud/actions/${props.id}/dismiss`, { method: 'POST' })
    setBusy(false)
    if (res.ok) setStatus('dismissed')
  }

  async function saveEdit() {
    setBusy(true)
    setError(null)
    const payloadPatch: Record<string, unknown> = {}
    if (props.kind === 'send_email') {
      payloadPatch.subject = draft.subject
      payloadPatch.body = draft.body
    } else if (props.kind === 'create_calendar_event') {
      payloadPatch.title = draft.title
      payloadPatch.start_iso = draft.start_iso
      if (draft.end_iso) payloadPatch.end_iso = draft.end_iso
    }
    const body: Record<string, unknown> = { payload_patch: payloadPatch }
    if (draft.recipient_email) {
      body.target_email = draft.recipient_email
      body.recipient_resolved = true
    }
    const res = await fetch(`/api/plaud/actions/${props.id}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (json.ok) {
      setEditing(false)
      if (status === 'failed') setStatus('pending')
    } else {
      setError(json.error ?? 'failed')
    }
  }

  const recipient =
    props.recipient_unresolved
      ? `⚠ "${props.recipient_unresolved}" not in directory`
      : props.target_display_name || props.target_email || null

  return (
    <div
      style={{
        padding: '0.6rem 0.8rem',
        borderTop: '1px solid var(--border-soft)',
        background: isDismissed ? 'var(--paper-2)' : undefined,
        opacity: isDismissed ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          className="status"
          style={{
            background:
              isDone ? 'var(--green-soft, #e6f4ea)' :
              status === 'failed' ? 'var(--red-soft, #fde7e7)' :
              isDismissed ? 'var(--paper-3)' :
              'var(--paper-2)',
          }}
        >
          {KIND_LABEL[props.kind]}
        </span>
        <p className="name" style={{ margin: 0, flex: 1 }}>{summaryFor(props)}</p>
        {status === 'pending' && PEOPLE_TOUCHING.has(props.kind) && <span className="meta" style={{ fontSize: '0.72rem' }}>awaiting send</span>}
        {isDone && props.auto_executed && <span className="meta" style={{ fontSize: '0.72rem' }}>auto</span>}
        {isDone && !props.auto_executed && <span className="meta" style={{ fontSize: '0.72rem' }}>sent</span>}
      </div>

      {recipient && (
        <p className="meta" style={{ margin: '0.2rem 0 0', fontSize: '0.78rem' }}>
          → {recipient}
        </p>
      )}
      {props.reasoning && !editing && (
        <p className="meta" style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', fontStyle: 'italic' }}>
          {props.reasoning}
        </p>
      )}
      {error && (
        <p className="meta" style={{ color: 'var(--red)', margin: '0.3rem 0 0', fontSize: '0.78rem' }}>
          {error}
        </p>
      )}
      {isDone && typeof props.result?.drive_url === 'string' && (
        <a href={props.result.drive_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.82rem' }}>
          Open in Drive →
        </a>
      )}
      {isDone && typeof props.result?.html_link === 'string' && (
        <a href={props.result.html_link} target="_blank" rel="noreferrer" style={{ fontSize: '0.82rem' }}>
          Open event →
        </a>
      )}

      {editing && (
        <EditForm
          kind={props.kind}
          draft={draft}
          setDraft={setDraft}
          directoryOptions={props.directoryOptions ?? []}
          listId={`plaud-dir-${props.id}`}
        />
      )}

      {!isDone && !isDismissed && (
        <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.45rem', flexWrap: 'wrap' }}>
          {editing && (
            <>
              <button className="btn approve" onClick={saveEdit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
            </>
          )}
          {!editing && (
            <>
              {showApprove && (
                <button className="btn approve" onClick={approve} disabled={busy}>
                  {busy ? 'Sending…' : props.kind === 'send_email' ? 'Send' : 'Create event'}
                </button>
              )}
              {showRetry && (
                <button className="btn" onClick={approve} disabled={busy}>Retry</button>
              )}
              {(PEOPLE_TOUCHING.has(props.kind) || showRetry || props.recipient_unresolved) && (
                <button className="btn" onClick={() => setEditing(true)}>Edit</button>
              )}
              {showDismiss && (
                <button className="btn" onClick={dismiss} disabled={busy}>Dismiss</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function summaryFor(props: PlaudActionRowProps): string {
  const p = props.payload
  switch (props.kind) {
    case 'create_task':
      return String(p.content ?? 'task')
    case 'create_doc':
      return String(p.title ?? 'doc')
    case 'send_email':
      return String(p.subject ?? 'email')
    case 'create_calendar_event':
      return String(p.title ?? 'event')
    case 'update_sheet':
      return `Update sheet: ${String(p.contact ?? '')}`
    case 'notify_member':
      return String(p.message ?? '').slice(0, 80)
  }
}

function EditForm({
  kind,
  draft,
  setDraft,
  directoryOptions,
  listId,
}: {
  kind: PlaudActionRowProps['kind']
  draft: Record<string, string>
  setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>
  directoryOptions: DirectoryOption[]
  listId: string
}) {
  const update = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }))
  return (
    <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.5rem' }}>
      <input
        type="email"
        placeholder="Recipient email — start typing a name"
        value={draft.recipient_email}
        onChange={(e) => update('recipient_email', e.target.value)}
        list={listId}
      />
      <datalist id={listId}>
        {directoryOptions.map((o) => (
          <option key={o.email} value={o.email}>{o.name}</option>
        ))}
      </datalist>
      {kind === 'send_email' && (
        <>
          <input
            type="text"
            placeholder="Subject"
            value={draft.subject}
            onChange={(e) => update('subject', e.target.value)}
          />
          <textarea
            placeholder="Body"
            rows={6}
            value={draft.body}
            onChange={(e) => update('body', e.target.value)}
          />
        </>
      )}
      {kind === 'create_calendar_event' && (
        <>
          <input
            type="text"
            placeholder="Title"
            value={draft.title}
            onChange={(e) => update('title', e.target.value)}
          />
          <input
            type="text"
            placeholder="Start (ISO 8601, e.g. 2026-05-22T14:00:00-04:00)"
            value={draft.start_iso}
            onChange={(e) => update('start_iso', e.target.value)}
          />
          <input
            type="text"
            placeholder="End (ISO 8601) — optional"
            value={draft.end_iso}
            onChange={(e) => update('end_iso', e.target.value)}
          />
        </>
      )}
    </div>
  )
}
