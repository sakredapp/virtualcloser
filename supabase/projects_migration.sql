-- Projects / Project Management migration.
--
-- A ClickUp-style project tab inside the Suite (CXO + Virtual Closer). The
-- user pastes a prompt or uploads a PDF/DOCX (e.g. a launch plan); Claude
-- parses it into a structured plan that mirrors the source doc:
--
--   projects            → one row per project (name, description, status, owner)
--   project_sections    → top-level groupings ("Day 1 — Foundation")
--   project_tasks       → the numbered steps under a section, each with an
--                          owner, time estimate, and status (the checkable item)
--   project_task_steps  → the action-item checkboxes under a task
--
-- Multi-tenant: every row carries rep_id (text → reps.id, same as leads).
-- owner_member_id / assigned_to reference members(id) which is a uuid.
-- The AI suggests an owner by name (owner_hint); the create route fuzzy-matches
-- that to a member and fills assigned_to where confident — unmatched stays null
-- for manual assignment in the UI.

create table if not exists projects (
  id               uuid primary key default gen_random_uuid(),
  rep_id           text not null references reps(id) on delete cascade,
  owner_member_id  uuid references members(id) on delete set null,
  name             text not null,
  description      text,
  source_kind      text not null default 'prompt'
                     check (source_kind in ('prompt','pdf','docx','manual')),
  source_text      text,
  status           text not null default 'active'
                     check (status in ('active','paused','completed','archived')),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index if not exists projects_rep_id_idx on projects(rep_id);
create index if not exists projects_rep_status_idx on projects(rep_id, status);
create index if not exists projects_owner_idx on projects(owner_member_id) where owner_member_id is not null;

create table if not exists project_sections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  rep_id      text not null references reps(id) on delete cascade,
  title       text not null,
  subtitle    text,
  position    integer not null default 0,
  created_at  timestamptz default now()
);

create index if not exists project_sections_project_idx on project_sections(project_id, position);
create index if not exists project_sections_rep_idx on project_sections(rep_id);

create table if not exists project_tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  section_id     uuid references project_sections(id) on delete cascade,
  rep_id         text not null references reps(id) on delete cascade,
  title          text not null,
  description    text,
  owner_hint     text,
  assigned_to    uuid references members(id) on delete set null,
  time_estimate  text,
  status         text not null default 'todo'
                   check (status in ('todo','in_progress','done','blocked')),
  position       integer not null default 0,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists project_tasks_project_idx on project_tasks(project_id, position);
create index if not exists project_tasks_section_idx on project_tasks(section_id, position);
create index if not exists project_tasks_rep_idx on project_tasks(rep_id);
create index if not exists project_tasks_assigned_idx on project_tasks(assigned_to) where assigned_to is not null;

create table if not exists project_task_steps (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references project_tasks(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  rep_id      text not null references reps(id) on delete cascade,
  content     text not null,
  done        boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz default now()
);

create index if not exists project_task_steps_task_idx on project_task_steps(task_id, position);
create index if not exists project_task_steps_project_idx on project_task_steps(project_id);
create index if not exists project_task_steps_rep_idx on project_task_steps(rep_id);

-- keep updated_at fresh on projects + tasks
create or replace function set_updated_at_projects() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at before update on projects
  for each row execute function set_updated_at_projects();

drop trigger if exists project_tasks_set_updated_at on project_tasks;
create trigger project_tasks_set_updated_at before update on project_tasks
  for each row execute function set_updated_at_projects();

-- RLS on (no policies) to match the rest of the schema. All app access goes
-- through the service-role key (lib/supabase.ts), which bypasses RLS; anon /
-- authenticated roles get no access.
alter table projects enable row level security;
alter table project_sections enable row level security;
alter table project_tasks enable row level security;
alter table project_task_steps enable row level security;
