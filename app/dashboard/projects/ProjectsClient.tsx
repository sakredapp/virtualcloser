'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import DashboardNav from '@/app/dashboard/DashboardNav'
import type { DashboardNavData } from '@/app/dashboard/dashboardTabs'
import type { ProjectSummary } from '@/lib/projects'

export default function ProjectsClient({
  repName,
  navTabs,
  initialProjects,
}: {
  repName: string
  navTabs: DashboardNavData
  initialProjects: ProjectSummary[]
}) {
  const router = useRouter()
  const [projects] = useState<ProjectSummary[]>(initialProjects)
  const [showNew, setShowNew] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // Guided ("AI asks first") flow.
  const [questions, setQuestions] = useState<string[] | null>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const [intaking, setIntaking] = useState(false)

  /** Compose the prompt sent to /api/projects, folding in any guided answers. */
  function composedPrompt(): string {
    const base = prompt.trim()
    if (!questions || questions.length === 0) return base
    const qa = questions
      .map((q, i) => `Q: ${q}\nA: ${answers[i]?.trim() || '(no answer)'}`)
      .join('\n\n')
    return `${base}\n\nClarifying answers:\n${qa}`.trim()
  }

  /** Step 1 of guided build: ask the AI what it needs to know. */
  async function startGuided() {
    if (!prompt.trim() && !file) {
      setError('Type a prompt or attach a PDF/Word doc first.')
      return
    }
    setError(null)
    setIntaking(true)
    try {
      let res: Response
      if (file) {
        const form = new FormData()
        form.append('file', file)
        if (prompt.trim()) form.append('prompt', prompt.trim())
        res = await fetch('/api/projects/intake', { method: 'POST', body: form })
      } else {
        res = await fetch('/api/projects/intake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt.trim() }),
        })
      }
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; questions?: string[]; error?: string }
      if (!res.ok || !json.ok) {
        setError(typeof json.error === 'string' ? json.error : `Failed (${res.status})`)
        return
      }
      const qs = json.questions ?? []
      if (qs.length === 0) {
        // Already detailed enough — just build.
        await build()
        return
      }
      setQuestions(qs)
      setAnswers(qs.map(() => ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — try again.')
    } finally {
      setIntaking(false)
    }
  }

  async function build() {
    const finalPrompt = composedPrompt()
    if (!finalPrompt && !file) {
      setError('Type a prompt or attach a PDF/Word doc.')
      return
    }
    setError(null)
    setBuilding(true)
    try {
      let res: Response
      if (file) {
        const form = new FormData()
        form.append('file', file)
        if (finalPrompt) form.append('prompt', finalPrompt)
        if (title.trim()) form.append('title', title.trim())
        res = await fetch('/api/projects', { method: 'POST', body: form })
      } else {
        res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: finalPrompt, title: title.trim() || undefined }),
        })
      }
      const json = await res.json().catch(() => ({}) as Record<string, unknown>)
      if (!res.ok || !json.ok) {
        setError(typeof json.error === 'string' ? json.error : `Failed (${res.status})`)
        return
      }
      router.push(`/dashboard/projects/${json.projectId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — try again.')
    } finally {
      setBuilding(false)
    }
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Projects</p>
        <h1>Project Management</h1>
        <p className="sub">
          Drop in a prompt or a document — {repName.split(' ')[0] || 'we'}&apos;ll turn it into a step-by-step
          plan you can assign and check off.
        </p>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <section className="card">
        <div className="section-head">
          <h2>Your projects</h2>
          <button type="button" className="btn approve" onClick={() => setShowNew((v) => !v)}>
            {showNew ? 'Close' : '+ New project'}
          </button>
        </div>

        {showNew && (
          <div className="new-box">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project name (optional — we'll suggest one)"
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Describe the project, or paste notes. e.g. 'Plan our Q3 product launch'. If you attach a file, this steers how it's broken down."
            />
            <div className="file-row">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt,.md"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setFile(null)
                    if (fileRef.current) fileRef.current.value = ''
                  }}
                >
                  remove
                </button>
              )}
            </div>
            {questions && questions.length > 0 && (
              <div className="qa">
                <p className="qa-head">A few quick questions so the plan fits — answer what you can:</p>
                {questions.map((q, i) => (
                  <label key={i} className="qa-row">
                    <span>{q}</span>
                    <input
                      value={answers[i] ?? ''}
                      onChange={(e) =>
                        setAnswers((prev) => {
                          const next = [...prev]
                          next[i] = e.target.value
                          return next
                        })
                      }
                      placeholder="Your answer (optional)"
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="actions">
              {questions && questions.length > 0 ? (
                <button type="button" className="btn approve" onClick={build} disabled={building}>
                  {building ? 'Building plan…' : 'Build with answers'}
                </button>
              ) : (
                <>
                  <button type="button" className="btn approve" onClick={build} disabled={building || intaking}>
                    {building ? 'Building plan…' : 'Build now'}
                  </button>
                  <button type="button" className="btn dismiss" onClick={startGuided} disabled={building || intaking}>
                    {intaking ? 'Thinking…' : 'Guided build (AI asks first)'}
                  </button>
                </>
              )}
            </div>
            {error && <p className="err">{error}</p>}
            <p className="hint">PDF, Word (.docx), text, or a transcript. Max 15 MB. Building a long doc can take ~30s.</p>
          </div>
        )}

        {projects.length === 0 ? (
          <p className="empty">No projects yet. Hit “New project” to build your first one.</p>
        ) : (
          <ul className="proj-list">
            {projects.map((p) => {
              const pct = p.task_count > 0 ? Math.round((p.done_count / p.task_count) * 100) : 0
              return (
                <li key={p.id}>
                  <Link href={`/dashboard/projects/${p.id}`} className="proj">
                    <div className="proj-top">
                      <h3>{p.name}</h3>
                      <span className={`badge status ${p.status}`}>{p.status}</span>
                    </div>
                    {p.description && <p className="desc">{p.description}</p>}
                    <div className="bar">
                      <div className="fill" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="meta">
                      {p.done_count}/{p.task_count} tasks · {pct}%
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <style jsx>{`
        .section-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
        .new-box { margin: 0.8rem 0 1.2rem; display: flex; flex-direction: column; gap: 0.6rem; }
        .new-box input[type='text'],
        .new-box textarea {
          width: 100%;
          background: #fff;
          color: var(--ink);
          border: 1px solid var(--ink-soft);
          border-radius: 10px;
          padding: 0.7rem 0.8rem;
          font-family: inherit;
          font-size: 0.95rem;
          resize: vertical;
        }
        .new-box input:focus,
        .new-box textarea:focus {
          outline: none;
          border-color: var(--red);
          box-shadow: 0 0 0 3px var(--red-shadow-mid);
        }
        .file-row { display: flex; align-items: center; gap: 0.6rem; }
        .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
        .qa { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.8rem; border: 1px solid var(--ink-soft); border-radius: 10px; background: #fafafa; }
        .qa-head { margin: 0; font-size: 0.86rem; font-weight: 600; color: var(--ink); }
        .qa-row { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.86rem; }
        .qa-row span { color: var(--muted); }
        .qa-row input { padding: 0.5rem 0.6rem; border: 1px solid var(--ink-soft); border-radius: 8px; font-family: inherit; font-size: 0.9rem; }
        .link-btn { background: none; border: none; color: var(--red); cursor: pointer; font-size: 0.85rem; }
        .err { color: var(--red-deep); font-weight: 600; font-size: 0.9rem; }
        .hint { color: var(--muted); font-size: 0.82rem; }
        .proj-list { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.7rem; }
        .proj {
          display: block;
          border: 1px solid var(--ink-soft);
          border-radius: 12px;
          padding: 0.9rem 1rem;
          background: #fff;
          text-decoration: none;
          color: inherit;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .proj:hover { border-color: var(--red); box-shadow: 0 0 0 3px var(--red-shadow-mid); }
        .proj-top { display: flex; align-items: center; justify-content: space-between; gap: 0.7rem; }
        .proj-top h3 { margin: 0; font-size: 1.02rem; }
        .desc { margin: 0.35rem 0 0.55rem; color: var(--muted); font-size: 0.9rem; }
        .bar { height: 7px; border-radius: 999px; background: #ececec; overflow: hidden; }
        .fill { height: 100%; background: var(--red); border-radius: 999px; transition: width 0.2s; }
        .meta { margin: 0.4rem 0 0; font-size: 0.8rem; color: var(--muted); }
        .badge.status {
          font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.08em;
          padding: 0.16rem 0.55rem; border-radius: 999px; border: 1px solid var(--ink-soft);
          background: #fff; font-weight: 700;
        }
        .badge.status.active { background: #fff4d1; }
        .badge.status.completed { background: var(--red); color: #fff; border-color: var(--red); }
      `}</style>
    </main>
  )
}
