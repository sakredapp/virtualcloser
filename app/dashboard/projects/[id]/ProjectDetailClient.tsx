'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import DashboardNav from '@/app/dashboard/DashboardNav'
import type { DashboardNavData } from '@/app/dashboard/dashboardTabs'
import type {
  ProjectDetail,
  ProjectSection,
  ProjectTask,
  ProjectTaskStep,
  ProjectTaskStatus,
} from '@/lib/projects'

type MemberLite = { id: string; name: string }

const STATUS_LABELS: Record<ProjectTaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
}
const STATUS_ORDER: ProjectTaskStatus[] = ['todo', 'in_progress', 'done', 'blocked']

const jsonPost = (url: string, method: string, body: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(
    () => undefined,
  )

export default function ProjectDetailClient({
  navTabs,
  detail,
  members,
}: {
  navTabs: DashboardNavData
  detail: ProjectDetail
  members: MemberLite[]
}) {
  const router = useRouter()
  const projectId = detail.project.id
  const [name, setName] = useState(detail.project.name)
  const [editingName, setEditingName] = useState(false)
  const [sections, setSections] = useState<ProjectSection[]>(detail.sections)
  const [tasks, setTasks] = useState<ProjectTask[]>(detail.tasks)
  const [steps, setSteps] = useState<ProjectTaskStep[]>(detail.steps)
  const [newSection, setNewSection] = useState('')

  const totalTasks = tasks.length
  const doneTasks = tasks.filter((t) => t.status === 'done').length
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  const stepsForTask = (taskId: string) => steps.filter((s) => s.task_id === taskId)

  // ── persistence + optimistic state ────────────────────────────────────────
  async function patchTask(task: ProjectTask, patch: Partial<ProjectTask>, body: Record<string, unknown>) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...patch } : t)))
    await jsonPost('/api/projects/task', 'PATCH', { taskId: task.id, ...body })
  }

  async function deleteTask(task: ProjectTask) {
    if (!confirm(`Delete task “${task.title}”?`)) return
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    setSteps((prev) => prev.filter((s) => s.task_id !== task.id))
    await jsonPost('/api/projects/task', 'DELETE', { taskId: task.id })
  }

  async function addTask(sectionId: string | null, title: string) {
    const res = await jsonPost('/api/projects/task', 'POST', { projectId, sectionId, title })
    const json = (await res?.json().catch(() => ({}))) as { task?: ProjectTask }
    if (json.task) setTasks((prev) => [...prev, json.task as ProjectTask])
  }

  async function toggleStep(step: ProjectTaskStep) {
    const done = !step.done
    setSteps((prev) => prev.map((s) => (s.id === step.id ? { ...s, done } : s)))
    await jsonPost('/api/projects/step', 'PATCH', { stepId: step.id, done })
  }

  async function addStep(task: ProjectTask, content: string) {
    const res = await jsonPost('/api/projects/step', 'POST', { projectId, taskId: task.id, content })
    const json = (await res?.json().catch(() => ({}))) as { step?: ProjectTaskStep }
    if (json.step) setSteps((prev) => [...prev, json.step as ProjectTaskStep])
  }

  async function editStep(step: ProjectTaskStep, content: string) {
    setSteps((prev) => prev.map((s) => (s.id === step.id ? { ...s, content } : s)))
    await jsonPost('/api/projects/step', 'PATCH', { stepId: step.id, content })
  }

  async function deleteStep(step: ProjectTaskStep) {
    setSteps((prev) => prev.filter((s) => s.id !== step.id))
    await jsonPost('/api/projects/step', 'DELETE', { stepId: step.id })
  }

  async function addSection() {
    const title = newSection.trim()
    if (!title) return
    setNewSection('')
    const res = await jsonPost('/api/projects/section', 'POST', { projectId, title })
    const json = (await res?.json().catch(() => ({}))) as { section?: ProjectSection }
    if (json.section) setSections((prev) => [...prev, json.section as ProjectSection])
  }

  async function renameSection(section: ProjectSection, title: string) {
    setSections((prev) => prev.map((s) => (s.id === section.id ? { ...s, title } : s)))
    await jsonPost('/api/projects/section', 'PATCH', { sectionId: section.id, title })
  }

  async function deleteSection(section: ProjectSection) {
    if (!confirm(`Delete section “${section.title}” and all its tasks?`)) return
    const taskIds = new Set(tasks.filter((t) => t.section_id === section.id).map((t) => t.id))
    setSections((prev) => prev.filter((s) => s.id !== section.id))
    setTasks((prev) => prev.filter((t) => t.section_id !== section.id))
    setSteps((prev) => prev.filter((s) => !taskIds.has(s.task_id)))
    await jsonPost('/api/projects/section', 'DELETE', { sectionId: section.id })
  }

  async function saveName() {
    const next = name.trim()
    setEditingName(false)
    if (!next || next === detail.project.name) {
      setName(detail.project.name)
      return
    }
    await jsonPost(`/api/projects/${projectId}`, 'PATCH', { name: next })
  }

  async function removeProject() {
    if (!confirm(`Delete “${name}” and all its tasks? This can't be undone.`)) return
    await fetch(`/api/projects/${projectId}`, { method: 'DELETE' }).catch(() => {})
    router.push('/dashboard/projects')
  }

  const ungrouped = tasks.filter((t) => !t.section_id)

  const taskHandlers = {
    patchTask,
    deleteTask,
    toggleStep,
    addStep,
    editStep,
    deleteStep,
    stepsForTask,
    members,
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">
          <Link href="/dashboard/projects" className="back">
            ← Projects
          </Link>
        </p>
        {editingName ? (
          <div className="name-edit">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') {
                  setName(detail.project.name)
                  setEditingName(false)
                }
              }}
            />
            <button className="btn approve sm" onClick={saveName}>
              Save
            </button>
          </div>
        ) : (
          <h1 className="proj-name" onClick={() => setEditingName(true)} title="Click to rename">
            {name} <span className="pencil">✎</span>
          </h1>
        )}
        {detail.project.description && <p className="sub">{detail.project.description}</p>}
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <section className="card progress-card">
        <div className="bar big">
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="progress-meta">
          <span>
            {doneTasks}/{totalTasks} tasks complete · {pct}%
          </span>
          <button type="button" className="link-btn danger" onClick={removeProject}>
            Delete project
          </button>
        </div>
      </section>

      {sections.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          tasks={tasks.filter((t) => t.section_id === section.id)}
          onRename={(title) => renameSection(section, title)}
          onDelete={() => deleteSection(section)}
          onAddTask={(title) => addTask(section.id, title)}
          taskHandlers={taskHandlers}
        />
      ))}

      <section className="card">
        <div className="sec-head">
          <h2>{sections.length === 0 ? 'Tasks' : 'Other tasks'}</h2>
        </div>
        <TaskList tasks={ungrouped} {...taskHandlers} />
        <AddTaskRow onAdd={(title) => addTask(null, title)} />
      </section>

      <section className="card add-section-card">
        <input
          value={newSection}
          onChange={(e) => setNewSection(e.target.value)}
          placeholder="New section title…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') addSection()
          }}
        />
        <button className="btn approve sm" onClick={addSection} disabled={!newSection.trim()}>
          + Add section
        </button>
      </section>

      <style jsx>{`
        .back { color: var(--red); text-decoration: none; }
        .proj-name { cursor: pointer; }
        .proj-name .pencil { font-size: 0.7em; color: var(--ink-soft); opacity: 0; transition: opacity 0.15s; }
        .proj-name:hover .pencil { opacity: 1; }
        .name-edit { display: flex; gap: 0.5rem; align-items: center; }
        .name-edit input {
          font-size: 1.6rem; font-weight: 700; padding: 0.2rem 0.5rem;
          border: 1px solid var(--ink-soft); border-radius: 8px; min-width: 60%;
        }
        .progress-card { padding: 1rem 1.1rem; }
        .bar { height: 8px; border-radius: 999px; background: #ececec; overflow: hidden; }
        .bar.big { height: 12px; }
        .fill { height: 100%; background: var(--red); border-radius: 999px; transition: width 0.2s; }
        .progress-meta {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 0.55rem; font-size: 0.85rem; color: var(--muted);
        }
        .link-btn { background: none; border: none; cursor: pointer; font-size: 0.85rem; color: var(--red); }
        .link-btn.danger { color: var(--red-deep); }
        .sec-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.4rem; }
        .sec-head h2 { margin: 0; }
        .add-section-card { display: flex; gap: 0.6rem; align-items: center; }
        .add-section-card input {
          flex: 1; padding: 0.6rem 0.7rem; border: 1px solid var(--ink-soft);
          border-radius: 9px; font-family: inherit; font-size: 0.92rem;
        }
        :global(.btn.sm) { padding: 0.4rem 0.7rem; font-size: 0.82rem; }
      `}</style>
    </main>
  )
}

// ── Section block ────────────────────────────────────────────────────────────

type TaskHandlers = {
  patchTask: (task: ProjectTask, patch: Partial<ProjectTask>, body: Record<string, unknown>) => void
  deleteTask: (task: ProjectTask) => void
  toggleStep: (step: ProjectTaskStep) => void
  addStep: (task: ProjectTask, content: string) => void
  editStep: (step: ProjectTaskStep, content: string) => void
  deleteStep: (step: ProjectTaskStep) => void
  stepsForTask: (taskId: string) => ProjectTaskStep[]
  members: MemberLite[]
}

function SectionBlock({
  section,
  tasks,
  onRename,
  onDelete,
  onAddTask,
  taskHandlers,
}: {
  section: ProjectSection
  tasks: ProjectTask[]
  onRename: (title: string) => void
  onDelete: () => void
  onAddTask: (title: string) => void
  taskHandlers: TaskHandlers
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(section.title)
  const done = tasks.filter((t) => t.status === 'done').length

  return (
    <section className="card">
      <div className="sec-head">
        {editing ? (
          <input
            className="sec-title-input"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRename(title.trim() || section.title)
                setEditing(false)
              }
              if (e.key === 'Escape') {
                setTitle(section.title)
                setEditing(false)
              }
            }}
            onBlur={() => {
              if (title.trim() && title.trim() !== section.title) onRename(title.trim())
              else setTitle(section.title)
              setEditing(false)
            }}
          />
        ) : (
          <div>
            <h2 onClick={() => setEditing(true)} className="sec-title" title="Click to rename">
              {section.title}
            </h2>
            {section.subtitle && <p className="sec-sub">{section.subtitle}</p>}
          </div>
        )}
        <div className="sec-right">
          <span className="sec-count">
            {done}/{tasks.length}
          </span>
          <button className="x" onClick={onDelete} title="Delete section">
            ×
          </button>
        </div>
      </div>
      <TaskList tasks={tasks} {...taskHandlers} />
      <AddTaskRow onAdd={onAddTask} />

      <style jsx>{`
        .sec-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.4rem; }
        .sec-head h2 { margin: 0; }
        .sec-title { cursor: pointer; }
        .sec-title-input { font-size: 1.25rem; font-weight: 700; padding: 0.2rem 0.45rem; border: 1px solid var(--ink-soft); border-radius: 8px; }
        .sec-sub { margin: 0.25rem 0 0; color: var(--muted); font-size: 0.88rem; }
        .sec-right { display: flex; align-items: center; gap: 0.6rem; }
        .sec-count { font-weight: 700; color: var(--muted); font-size: 0.9rem; white-space: nowrap; }
        .x { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 1.2rem; line-height: 1; }
        .x:hover { color: var(--red-deep); }
      `}</style>
    </section>
  )
}

function AddTaskRow({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState('')
  const submit = () => {
    const t = title.trim()
    if (!t) return
    onAdd(t)
    setTitle('')
  }
  return (
    <div className="add-task">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="+ Add task"
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      {title.trim() && (
        <button className="btn approve sm" onClick={submit}>
          Add
        </button>
      )}
      <style jsx>{`
        .add-task { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.6rem; }
        .add-task input {
          flex: 1; padding: 0.55rem 0.7rem; border: 1px dashed var(--ink-soft);
          border-radius: 9px; font-family: inherit; font-size: 0.9rem; background: #fafafa;
        }
        .add-task input:focus { outline: none; border-style: solid; border-color: var(--red); background: #fff; }
      `}</style>
    </div>
  )
}

// ── Task list + card ─────────────────────────────────────────────────────────

function TaskList({
  tasks,
  patchTask,
  deleteTask,
  toggleStep,
  addStep,
  editStep,
  deleteStep,
  stepsForTask,
  members,
}: { tasks: ProjectTask[] } & TaskHandlers) {
  if (tasks.length === 0) return null
  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          steps={stepsForTask(task.id)}
          members={members}
          patchTask={patchTask}
          deleteTask={deleteTask}
          toggleStep={toggleStep}
          addStep={addStep}
          editStep={editStep}
          deleteStep={deleteStep}
        />
      ))}
      <style jsx>{`
        .task-list { list-style: none; padding: 0; margin: 0.4rem 0 0; display: flex; flex-direction: column; gap: 0.7rem; }
      `}</style>
    </ul>
  )
}

function TaskCard({
  task,
  steps,
  members,
  patchTask,
  deleteTask,
  toggleStep,
  addStep,
  editStep,
  deleteStep,
}: {
  task: ProjectTask
  steps: ProjectTaskStep[]
  members: MemberLite[]
  patchTask: TaskHandlers['patchTask']
  deleteTask: TaskHandlers['deleteTask']
  toggleStep: TaskHandlers['toggleStep']
  addStep: TaskHandlers['addStep']
  editStep: TaskHandlers['editStep']
  deleteStep: TaskHandlers['deleteStep']
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [time, setTime] = useState(task.time_estimate ?? '')
  const [newStep, setNewStep] = useState('')
  const stepsDone = steps.filter((s) => s.done).length

  function saveEdit() {
    const t = title.trim() || task.title
    patchTask(
      task,
      { title: t, time_estimate: time.trim() || null },
      { title: t, timeEstimate: time.trim() || null },
    )
    setEditing(false)
  }

  function submitStep() {
    const c = newStep.trim()
    if (!c) return
    addStep(task, c)
    setNewStep('')
  }

  return (
    <li className={`task ${task.status === 'done' ? 'is-done' : ''}`}>
      <div className="task-top">
        {editing ? (
          <input className="title-input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
        ) : (
          <div className="task-title">
            <span className={`dot ${task.status}`} />
            <span className="t">{task.title}</span>
          </div>
        )}
        <div className="task-controls">
          {!editing && task.time_estimate && <span className="badge time">{task.time_estimate}</span>}
          <select
            className="assign"
            value={task.assigned_to ?? ''}
            onChange={(e) => patchTask(task, { assigned_to: e.target.value || null }, { assignedTo: e.target.value || null })}
            aria-label="Assign task"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            className={`status-sel ${task.status}`}
            value={task.status}
            onChange={(e) => patchTask(task, { status: e.target.value as ProjectTaskStatus }, { status: e.target.value })}
            aria-label="Task status"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button className="icon" title={editing ? 'Cancel' : 'Edit task'} onClick={() => setEditing((v) => !v)}>
            {editing ? '×' : '✎'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="edit-row">
          <input
            className="time-input"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="Time estimate (e.g. 15 min)"
          />
          <button className="btn approve sm" onClick={saveEdit}>
            Save
          </button>
          <button className="link-btn danger" onClick={() => deleteTask(task)}>
            Delete task
          </button>
        </div>
      )}

      {task.description && !editing && <p className="task-desc">{task.description}</p>}
      {task.owner_hint && !task.assigned_to && (
        <p className="owner-hint">Suggested owner: {task.owner_hint} (unmatched — assign above)</p>
      )}

      <ul className="steps">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} onToggle={() => toggleStep(step)} onEdit={(c) => editStep(step, c)} onDelete={() => deleteStep(step)} />
        ))}
      </ul>

      <div className="add-step">
        <input
          value={newStep}
          onChange={(e) => setNewStep(e.target.value)}
          placeholder="+ Add step"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitStep()
          }}
        />
        {newStep.trim() && (
          <button className="btn approve sm" onClick={submitStep}>
            Add
          </button>
        )}
      </div>

      {steps.length > 0 && (
        <p className="step-meta">
          {stepsDone}/{steps.length} steps
        </p>
      )}

      <style jsx>{`
        .task { border: 1px solid var(--ink-soft); border-radius: 12px; padding: 0.8rem 0.9rem; background: #fff; }
        .task.is-done { opacity: 0.62; }
        .task-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.8rem; flex-wrap: wrap; }
        .task-title { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; }
        .task-title .t { font-size: 0.97rem; }
        .title-input { font-size: 0.97rem; font-weight: 600; padding: 0.3rem 0.5rem; border: 1px solid var(--ink-soft); border-radius: 8px; min-width: 50%; }
        .dot { width: 9px; height: 9px; border-radius: 999px; background: #cfcfcf; flex: none; }
        .dot.in_progress { background: #f0a500; }
        .dot.done { background: var(--red); }
        .dot.blocked { background: #b00020; }
        .task-controls { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
        .assign, .status-sel { font-size: 0.78rem; border: 1px solid var(--ink-soft); border-radius: 8px; padding: 0.28rem 0.4rem; background: #fff; color: var(--ink); font-family: inherit; }
        .status-sel.done { border-color: var(--red); color: var(--red); }
        .icon { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 0.95rem; padding: 0.2rem 0.3rem; }
        .icon:hover { color: var(--red); }
        .badge.time { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.16rem 0.5rem; border-radius: 999px; border: 1px solid var(--ink-soft); background: #fff4d1; font-weight: 700; white-space: nowrap; }
        .edit-row { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.55rem; flex-wrap: wrap; }
        .time-input { padding: 0.35rem 0.5rem; border: 1px solid var(--ink-soft); border-radius: 8px; font-family: inherit; font-size: 0.85rem; }
        .link-btn { background: none; border: none; cursor: pointer; font-size: 0.82rem; }
        .link-btn.danger { color: var(--red-deep); }
        .task-desc { margin: 0.5rem 0 0; color: var(--muted); font-size: 0.88rem; }
        .owner-hint { margin: 0.45rem 0 0; font-size: 0.78rem; color: var(--muted); font-style: italic; }
        .steps { list-style: none; padding: 0; margin: 0.55rem 0 0; display: flex; flex-direction: column; gap: 0.3rem; }
        .add-step { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.45rem; }
        .add-step input { flex: 1; padding: 0.4rem 0.6rem; border: 1px dashed var(--ink-soft); border-radius: 8px; font-family: inherit; font-size: 0.85rem; background: #fafafa; }
        .add-step input:focus { outline: none; border-style: solid; border-color: var(--red); background: #fff; }
        .step-meta { margin: 0.4rem 0 0; font-size: 0.76rem; color: var(--muted); }
      `}</style>
    </li>
  )
}

function StepRow({
  step,
  onToggle,
  onEdit,
  onDelete,
}: {
  step: ProjectTaskStep
  onToggle: () => void
  onEdit: (content: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(step.content)

  function save() {
    const t = text.trim()
    setEditing(false)
    if (!t || t === step.content) {
      setText(step.content)
      return
    }
    onEdit(t)
  }

  return (
    <li className="step">
      {editing ? (
        <input
          className="step-input"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') {
              setText(step.content)
              setEditing(false)
            }
          }}
        />
      ) : (
        <label className={step.done ? 'done' : ''}>
          <input type="checkbox" checked={step.done} onChange={onToggle} />
          <span onClick={(e) => { e.preventDefault(); setEditing(true) }} title="Click text to edit">
            {step.content}
          </span>
        </label>
      )}
      <button className="x" onClick={onDelete} title="Delete step">
        ×
      </button>
      <style jsx>{`
        .step { display: flex; align-items: flex-start; gap: 0.4rem; }
        .step label { display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.9rem; cursor: pointer; flex: 1; }
        .step label.done span { text-decoration: line-through; color: var(--ink-soft); }
        .step label input { margin-top: 0.2rem; accent-color: var(--red); }
        .step-input { flex: 1; padding: 0.3rem 0.5rem; border: 1px solid var(--red); border-radius: 7px; font-family: inherit; font-size: 0.88rem; }
        .x { background: none; border: none; cursor: pointer; color: #cfcfcf; font-size: 1rem; line-height: 1; padding: 0 0.2rem; }
        .x:hover { color: var(--red-deep); }
      `}</style>
    </li>
  )
}
