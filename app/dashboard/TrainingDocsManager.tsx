'use client'

// Tenant-side training doc panel — used on /dashboard/dialer (so the AI dialer
// references product/script PDFs) and /dashboard/roleplay (so the roleplay AI
// uses the same docs as a knowledge base).
//
// Behaviour:
//   - Lists existing active docs scoped to this member (account + personal).
//   - Drag-and-drop or click-to-pick file upload (PDF/.txt/.md/.docx).
//   - Inline "Paste text" form for snippets without a file.
//   - Toggle active / soft-delete.
//   - Optional kindFilter restricts what's shown (e.g. dialer page hides
//     case_study). Always shows everything if not provided.

import { useEffect, useRef, useState, useTransition } from 'react'

type Doc = {
  id: string
  title: string
  doc_kind: string
  scope: 'personal' | 'account'
  body: string | null
  storage_path: string | null
  is_active: boolean
  updated_at: string
}

type Props = {
  /** UI label, e.g. "Reference docs the AI dialer reads" */
  heading?: string
  /** Restrict the upload kinds dropdown */
  allowedKinds?: Array<
    'product_brief' | 'script' | 'objection_list' | 'case_study' | 'training' | 'reference'
  >
  /** Only docs of these kinds appear in the list */
  kindFilter?: string[]
  defaultKind?: string
}

const KIND_LABELS: Record<string, string> = {
  product_brief: 'Product brief',
  script: 'Script',
  objection_list: 'Objection list',
  case_study: 'Case study',
  training: 'Training notes',
  reference: 'Reference',
}

export default function TrainingDocsManager({
  heading = 'Reference documents',
  allowedKinds = ['product_brief', 'script', 'objection_list', 'reference', 'case_study', 'training'],
  kindFilter,
  defaultKind = 'reference',
}: Props) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [pasteBody, setPasteBody] = useState('')
  const [kind, setKind] = useState<string>(defaultKind)
  const [scope, setScope] = useState<'personal' | 'account'>('account')
  const [isDragging, setIsDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  async function refresh() {
    setLoading(true)
    try {
      const r = await fetch('/api/me/training-docs')
      const j = (await r.json()) as { ok: boolean; docs?: Doc[]; error?: string }
      if (j.ok && j.docs) setDocs(j.docs)
      else setErr(j.error ?? 'load failed')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  function uploadFile(file: File) {
    start(async () => {
      setErr(null)
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', title || file.name)
      fd.append('doc_kind', kind)
      fd.append('scope', scope)
      const r = await fetch('/api/me/training-docs', { method: 'POST', body: fd })
      const j = (await r.json()) as { ok: boolean; error?: string }
      if (j.ok) {
        setTitle('')
        await refresh()
      } else setErr(j.error ?? `HTTP ${r.status}`)
    })
  }

  function savePastedText() {
    if (!title.trim() || !pasteBody.trim()) {
      setErr('Title and body required')
      return
    }
    start(async () => {
      setErr(null)
      const r = await fetch('/api/me/training-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body: pasteBody, doc_kind: kind, scope }),
      })
      const j = (await r.json()) as { ok: boolean; error?: string }
      if (j.ok) {
        setTitle('')
        setPasteBody('')
        await refresh()
      } else setErr(j.error ?? `HTTP ${r.status}`)
    })
  }

  function toggle(d: Doc) {
    start(async () => {
      await fetch('/api/me/training-docs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: d.id, is_active: !d.is_active }),
      })
      await refresh()
    })
  }

  function remove(d: Doc) {
    if (!confirm(`Remove "${d.title}"? It won't feed the AI anymore.`)) return
    start(async () => {
      await fetch(`/api/me/training-docs?id=${d.id}`, { method: 'DELETE' })
      await refresh()
    })
  }

  const visible = docs.filter((d) => !kindFilter || kindFilter.includes(d.doc_kind))

  return (
    <section
      style={{
        margin: '0 24px 24px',
        borderRadius: 14,
        background: '#fff',
        color: 'var(--ink)',
        padding: '14px 16px',
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <p
            style={{
              margin: 0,
              fontSize: '0.66rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 800,
              color: 'var(--red)',
            }}
          >
            Knowledge base
          </p>
          <strong style={{ fontSize: '1rem' }}>{heading}</strong>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
            PDFs, .txt, .md, .docx · max 10MB. Toggling docs on/off updates your live AI
            assistant in real time.
          </p>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          const f = e.dataTransfer.files?.[0]
          if (f) uploadFile(f)
        }}
        onClick={() => fileInput.current?.click()}
        style={{
          marginTop: 12,
          padding: '18px 14px',
          border: `2px dashed ${isDragging ? 'var(--red)' : 'rgba(0,0,0,0.18)'}`,
          background: isDragging ? 'rgba(255,40,0,0.04)' : 'var(--paper-2, #f7f4ef)',
          borderRadius: 10,
          textAlign: 'center',
          cursor: 'pointer',
          fontSize: '0.85rem',
          color: 'var(--muted)',
        }}
      >
        {pending ? 'Uploading…' : 'Drop a file here, or click to choose. PDF / TXT / MD / DOCX.'}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.txt,.md,.docx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) uploadFile(f)
          e.target.value = ''
        }}
      />

      {/* Form row */}
      <div
        style={{
          marginTop: 10,
          display: 'grid',
          gridTemplateColumns: 'minmax(140px, 1fr) 140px 130px',
          gap: 8,
        }}
      >
        <input
          placeholder="Title (optional — defaults to filename)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputSt}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputSt}>
          {allowedKinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k] ?? k}
            </option>
          ))}
        </select>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as 'personal' | 'account')}
          style={inputSt}
        >
          <option value="account">Whole team</option>
          <option value="personal">Just me</option>
        </select>
      </div>

      {/* Paste text fallback */}
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: 'var(--red)', fontWeight: 700 }}>
          Or paste text instead of uploading
        </summary>
        <textarea
          rows={5}
          placeholder="Paste a script, objection list, or any reference text. The AI will read it."
          value={pasteBody}
          onChange={(e) => setPasteBody(e.target.value)}
          style={{ ...inputSt, marginTop: 8, fontFamily: 'inherit', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={savePastedText}
          style={{
            marginTop: 6,
            background: 'var(--red)',
            color: '#fff',
            border: 'none',
            padding: '8px 14px',
            borderRadius: 8,
            fontWeight: 700,
            cursor: pending ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {pending ? 'Saving…' : 'Save text'}
        </button>
      </details>

      {err && (
        <p style={{ marginTop: 10, color: '#dc2626', fontSize: '0.85rem', fontWeight: 600 }}>
          ✗ {err}
        </p>
      )}

      {/* List */}
      <div style={{ marginTop: 14 }}>
        {loading ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            No docs yet. Upload your first product brief or script above.
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {visible.map((d) => (
              <li
                key={d.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 0',
                  borderBottom: '1px solid rgba(0,0,0,0.06)',
                  opacity: d.is_active ? 1 : 0.55,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.title}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--muted)' }}>
                    {KIND_LABELS[d.doc_kind] ?? d.doc_kind} · {d.scope === 'account' ? 'team' : 'personal'} ·{' '}
                    {d.storage_path ? 'file' : 'inline'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(d)}
                  style={{
                    border: '1.5px solid var(--red)',
                    background: d.is_active ? 'var(--red)' : 'transparent',
                    color: d.is_active ? '#fff' : 'var(--red)',
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    cursor: 'pointer',
                  }}
                >
                  {d.is_active ? 'ACTIVE' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => remove(d)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontSize: '1rem',
                  }}
                  title="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

const inputSt: React.CSSProperties = {
  padding: '0.5rem 0.7rem',
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.15)',
  background: '#fff',
  color: 'var(--ink)',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
}
