import { supabase } from './supabase'
import { listMembers } from './members'
import type { ProjectPlan } from './claude'
import type { Member } from '@/types'

// ── Row types ──────────────────────────────────────────────────────────────

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
export type ProjectTaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked'

export type Project = {
  id: string
  rep_id: string
  owner_member_id: string | null
  name: string
  description: string | null
  source_kind: 'prompt' | 'pdf' | 'docx' | 'manual'
  source_text: string | null
  status: ProjectStatus
  created_at: string
  updated_at: string
}

export type ProjectSection = {
  id: string
  project_id: string
  rep_id: string
  title: string
  subtitle: string | null
  position: number
  created_at: string
}

export type ProjectTask = {
  id: string
  project_id: string
  section_id: string | null
  rep_id: string
  title: string
  description: string | null
  owner_hint: string | null
  assigned_to: string | null
  time_estimate: string | null
  status: ProjectTaskStatus
  position: number
  created_at: string
  updated_at: string
}

export type ProjectTaskStep = {
  id: string
  task_id: string
  project_id: string
  rep_id: string
  content: string
  done: boolean
  position: number
  created_at: string
}

/** Project with a derived progress summary (for the list page). */
export type ProjectSummary = Project & {
  task_count: number
  done_count: number
}

/** Fully hydrated project for the detail page. */
export type ProjectDetail = {
  project: Project
  sections: ProjectSection[]
  tasks: ProjectTask[]
  steps: ProjectTaskStep[]
}

// ── Owner matching ───────────────────────────────────────────────────────────

/**
 * Fuzzy-match an AI owner_hint ("Brad", "Wayne Carr") to a member of the
 * tenant. We only auto-assign on a confident match: exact (case-insensitive)
 * on display name / first name / slug / email-local-part. Ambiguous or
 * no-match → null, left for manual assignment in the UI.
 */
export function matchOwnerHint(hint: string | null | undefined, members: Member[]): string | null {
  if (!hint) return null
  const h = hint.trim().toLowerCase()
  if (!h) return null

  const candidates = members.map((m) => ({
    id: m.id,
    full: (m.display_name ?? '').trim().toLowerCase(),
    first: (m.display_name ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '',
    slug: (m.slug ?? '').trim().toLowerCase(),
    emailLocal: (m.email ?? '').split('@')[0]?.trim().toLowerCase() ?? '',
  }))

  // 1. Exact full-name match.
  const full = candidates.filter((c) => c.full && c.full === h)
  if (full.length === 1) return full[0].id

  // 2. Exact first-name / slug / email-local match — only if unambiguous.
  const partial = candidates.filter(
    (c) => (c.first && c.first === h) || (c.slug && c.slug === h) || (c.emailLocal && c.emailLocal === h),
  )
  if (partial.length === 1) return partial[0].id

  return null
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listProjects(repId: string): Promise<ProjectSummary[]> {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .eq('rep_id', repId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })
  if (error) throw error
  const rows = (projects ?? []) as Project[]
  if (rows.length === 0) return []

  // Pull task status counts in one query, fold into per-project totals.
  const { data: tasks, error: tErr } = await supabase
    .from('project_tasks')
    .select('project_id, status')
    .eq('rep_id', repId)
  if (tErr) throw tErr

  const counts = new Map<string, { total: number; done: number }>()
  for (const t of (tasks ?? []) as Array<{ project_id: string; status: ProjectTaskStatus }>) {
    const c = counts.get(t.project_id) ?? { total: 0, done: 0 }
    c.total += 1
    if (t.status === 'done') c.done += 1
    counts.set(t.project_id, c)
  }

  return rows.map((p) => {
    const c = counts.get(p.id) ?? { total: 0, done: 0 }
    return { ...p, task_count: c.total, done_count: c.done }
  })
}

export async function getProjectDetail(repId: string, projectId: string): Promise<ProjectDetail | null> {
  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('rep_id', repId)
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw error
  if (!project) return null

  // Scope children by rep_id as well as project_id. Every legitimate child row
  // carries the owner's rep_id, so this is a no-op for valid data while closing
  // a cross-tenant seam: the create routes accept a client-supplied projectId,
  // so a row inserted under another tenant's rep_id must never render here.
  const [sectionsRes, tasksRes, stepsRes] = await Promise.all([
    supabase.from('project_sections').select('*').eq('rep_id', repId).eq('project_id', projectId).order('position', { ascending: true }),
    supabase.from('project_tasks').select('*').eq('rep_id', repId).eq('project_id', projectId).order('position', { ascending: true }),
    supabase.from('project_task_steps').select('*').eq('rep_id', repId).eq('project_id', projectId).order('position', { ascending: true }),
  ])
  if (sectionsRes.error) throw sectionsRes.error
  if (tasksRes.error) throw tasksRes.error
  if (stepsRes.error) throw stepsRes.error

  return {
    project: project as Project,
    sections: (sectionsRes.data ?? []) as ProjectSection[],
    tasks: (tasksRes.data ?? []) as ProjectTask[],
    steps: (stepsRes.data ?? []) as ProjectTaskStep[],
  }
}

/** A task assigned to a member, with its project name — for the dashboard rollup. */
export type AssignedTask = {
  id: string
  project_id: string
  project_name: string
  title: string
  status: ProjectTaskStatus
  time_estimate: string | null
}

/**
 * Open project tasks assigned to a member, across all their tenant's active
 * projects. Powers the "your project tasks" widget on the dashboard so the PM
 * portal feeds each person's daily to-do list.
 */
export async function getMyOpenTasks(repId: string, memberId: string, limit = 25): Promise<AssignedTask[]> {
  const { data: tasks, error } = await supabase
    .from('project_tasks')
    .select('id, project_id, title, status, time_estimate')
    .eq('rep_id', repId)
    .eq('assigned_to', memberId)
    .neq('status', 'done')
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = (tasks ?? []) as Array<Pick<ProjectTask, 'id' | 'project_id' | 'title' | 'status' | 'time_estimate'>>
  if (rows.length === 0) return []

  const projectIds = Array.from(new Set(rows.map((t) => t.project_id)))
  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, name, status')
    .eq('rep_id', repId)
    .in('id', projectIds)
    .in('status', ['active', 'paused'])
  if (pErr) throw pErr
  const nameById = new Map<string, string>()
  for (const p of (projects ?? []) as Array<{ id: string; name: string }>) nameById.set(p.id, p.name)

  return rows
    .filter((t) => nameById.has(t.project_id))
    .map((t) => ({
      id: t.id,
      project_id: t.project_id,
      project_name: nameById.get(t.project_id) as string,
      title: t.title,
      status: t.status,
      time_estimate: t.time_estimate,
    }))
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Insert a whole AI-generated plan (project → sections → tasks → steps) for a
 * tenant. Owner hints are matched to members and filled into assigned_to where
 * confident. Returns the new project id.
 */
export async function createProjectFromPlan(input: {
  repId: string
  ownerMemberId: string | null
  plan: ProjectPlan
  sourceKind: Project['source_kind']
  sourceText?: string | null
}): Promise<string> {
  const { repId, ownerMemberId, plan } = input
  const members = await listMembers(repId)

  const { data: projectRow, error: pErr } = await supabase
    .from('projects')
    .insert({
      rep_id: repId,
      owner_member_id: ownerMemberId,
      name: plan.name,
      description: plan.description || null,
      source_kind: input.sourceKind,
      source_text: input.sourceText ?? null,
      status: 'active',
    })
    .select('id')
    .single()
  if (pErr) throw pErr
  const projectId = projectRow.id as string

  let sectionPos = 0
  for (const section of plan.sections) {
    const { data: secRow, error: sErr } = await supabase
      .from('project_sections')
      .insert({
        project_id: projectId,
        rep_id: repId,
        title: section.title,
        subtitle: section.subtitle ?? null,
        position: sectionPos++,
      })
      .select('id')
      .single()
    if (sErr) throw sErr
    const sectionId = secRow.id as string

    let taskPos = 0
    for (const task of section.tasks) {
      const { data: taskRow, error: tErr } = await supabase
        .from('project_tasks')
        .insert({
          project_id: projectId,
          section_id: sectionId,
          rep_id: repId,
          title: task.title,
          description: task.description ?? null,
          owner_hint: task.owner_hint ?? null,
          assigned_to: matchOwnerHint(task.owner_hint, members),
          time_estimate: task.time_estimate ?? null,
          status: 'todo',
          position: taskPos++,
        })
        .select('id')
        .single()
      if (tErr) throw tErr
      const taskId = taskRow.id as string

      if (task.steps.length > 0) {
        const stepRows = task.steps.map((content, i) => ({
          task_id: taskId,
          project_id: projectId,
          rep_id: repId,
          content,
          done: false,
          position: i,
        }))
        const { error: stErr } = await supabase.from('project_task_steps').insert(stepRows)
        if (stErr) throw stErr
      }
    }
  }

  return projectId
}

// ── Manual editing (sections / tasks / steps) ───────────────────────────────

async function nextPosition(
  table: 'project_sections' | 'project_tasks' | 'project_task_steps',
  filter: { col: string; val: string | null },
): Promise<number> {
  let q = supabase.from(table).select('position').order('position', { ascending: false }).limit(1)
  q = filter.val === null ? q.is(filter.col, null) : q.eq(filter.col, filter.val)
  const { data } = await q
  const top = (data?.[0] as { position?: number } | undefined)?.position
  return typeof top === 'number' ? top + 1 : 0
}

export async function createSection(input: {
  repId: string
  projectId: string
  title: string
  subtitle?: string | null
}): Promise<ProjectSection> {
  const position = await nextPosition('project_sections', { col: 'project_id', val: input.projectId })
  const { data, error } = await supabase
    .from('project_sections')
    .insert({
      rep_id: input.repId,
      project_id: input.projectId,
      title: input.title,
      subtitle: input.subtitle ?? null,
      position,
    })
    .select()
    .single()
  if (error) throw error
  return data as ProjectSection
}

export async function renameSection(repId: string, sectionId: string, title: string): Promise<void> {
  const { error } = await supabase
    .from('project_sections')
    .update({ title })
    .eq('rep_id', repId)
    .eq('id', sectionId)
  if (error) throw error
}

export async function deleteSection(repId: string, sectionId: string): Promise<void> {
  // Tasks in this section cascade-delete (FK). Use with care.
  const { error } = await supabase.from('project_sections').delete().eq('rep_id', repId).eq('id', sectionId)
  if (error) throw error
}

export async function createTask(input: {
  repId: string
  projectId: string
  sectionId: string | null
  title: string
}): Promise<ProjectTask> {
  const position = input.sectionId
    ? await nextPosition('project_tasks', { col: 'section_id', val: input.sectionId })
    : await nextPosition('project_tasks', { col: 'project_id', val: input.projectId })
  const { data, error } = await supabase
    .from('project_tasks')
    .insert({
      rep_id: input.repId,
      project_id: input.projectId,
      section_id: input.sectionId,
      title: input.title,
      status: 'todo',
      position,
    })
    .select()
    .single()
  if (error) throw error
  return data as ProjectTask
}

/** Patch free-text task fields (title / description / time estimate). */
export async function updateTaskFields(
  repId: string,
  taskId: string,
  fields: { title?: string; description?: string | null; time_estimate?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (typeof fields.title === 'string') patch.title = fields.title
  if ('description' in fields) patch.description = fields.description ?? null
  if ('time_estimate' in fields) patch.time_estimate = fields.time_estimate ?? null
  if (Object.keys(patch).length === 0) return
  const { error } = await supabase.from('project_tasks').update(patch).eq('rep_id', repId).eq('id', taskId)
  if (error) throw error
}

export async function deleteTask(repId: string, taskId: string): Promise<void> {
  // Steps cascade-delete (FK).
  const { error } = await supabase.from('project_tasks').delete().eq('rep_id', repId).eq('id', taskId)
  if (error) throw error
}

export async function createStep(input: {
  repId: string
  projectId: string
  taskId: string
  content: string
}): Promise<ProjectTaskStep> {
  const position = await nextPosition('project_task_steps', { col: 'task_id', val: input.taskId })
  const { data, error } = await supabase
    .from('project_task_steps')
    .insert({
      rep_id: input.repId,
      project_id: input.projectId,
      task_id: input.taskId,
      content: input.content,
      done: false,
      position,
    })
    .select()
    .single()
  if (error) throw error
  return data as ProjectTaskStep
}

export async function updateStepContent(repId: string, stepId: string, content: string): Promise<void> {
  const { error } = await supabase
    .from('project_task_steps')
    .update({ content })
    .eq('rep_id', repId)
    .eq('id', stepId)
  if (error) throw error
}

export async function deleteStep(repId: string, stepId: string): Promise<void> {
  const { error } = await supabase.from('project_task_steps').delete().eq('rep_id', repId).eq('id', stepId)
  if (error) throw error
}

export async function renameProject(
  repId: string,
  projectId: string,
  fields: { name?: string; description?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (typeof fields.name === 'string' && fields.name.trim()) patch.name = fields.name.trim()
  if ('description' in fields) patch.description = fields.description ?? null
  if (Object.keys(patch).length === 0) return
  const { error } = await supabase.from('projects').update(patch).eq('rep_id', repId).eq('id', projectId)
  if (error) throw error
}

export async function setTaskStatus(repId: string, taskId: string, status: ProjectTaskStatus): Promise<void> {
  const { error } = await supabase
    .from('project_tasks')
    .update({ status })
    .eq('rep_id', repId)
    .eq('id', taskId)
  if (error) throw error
}

export async function assignTask(repId: string, taskId: string, memberId: string | null): Promise<void> {
  const { error } = await supabase
    .from('project_tasks')
    .update({ assigned_to: memberId })
    .eq('rep_id', repId)
    .eq('id', taskId)
  if (error) throw error
}

/**
 * Toggle a checklist step. When all of a task's steps become done we don't
 * auto-complete the task (the owner decides), but we surface progress in the UI.
 */
export async function setStepDone(repId: string, stepId: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('project_task_steps')
    .update({ done })
    .eq('rep_id', repId)
    .eq('id', stepId)
  if (error) throw error
}

export async function setProjectStatus(repId: string, projectId: string, status: ProjectStatus): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ status })
    .eq('rep_id', repId)
    .eq('id', projectId)
  if (error) throw error
}

export async function deleteProject(repId: string, projectId: string): Promise<void> {
  // Children cascade via FK ON DELETE CASCADE.
  const { error } = await supabase.from('projects').delete().eq('rep_id', repId).eq('id', projectId)
  if (error) throw error
}
