-- agent_history migration
-- Replaces the agent_history JSONB stored inside members.settings with a
-- proper table. Benefits:
--   1. History survives a settings reset / admin wipe.
--   2. Window is no longer capped by JSONB size — load the last 40 rows.
--   3. Queryable per-member: useful for debugging, analytics, future search.
--
-- Safe to run multiple times (idempotent).

create table if not exists agent_history (
  id            uuid        primary key default gen_random_uuid(),
  member_id     uuid        not null references members(id) on delete cascade,
  rep_id        text        not null references reps(id)    on delete cascade,
  role          text        not null check (role in ('user', 'assistant')),
  content       text        not null,
  -- nullable: only present on assistant turns where list_brain_items ran,
  -- so the complete_task handler can resolve "those" / "#2" back-references.
  listed_tasks  jsonb       default null,
  created_at    timestamptz default now()
);

-- Lookup index: webhook loads last 40 rows per member ordered by created_at.
create index if not exists agent_history_member_time_idx
  on agent_history (member_id, created_at desc);

-- Optional cleanup: auto-delete entries older than 90 days so the table
-- doesn't grow unbounded. Remove this block if you want infinite history.
-- Requires pg_cron (available on Supabase Pro). Skip safely if not installed.
do $$
begin
  if exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) then
    perform cron.schedule(
      'prune-agent-history',
      '0 3 * * *',  -- 3am UTC daily
      $$
        delete from agent_history
        where created_at < now() - interval '90 days';
      $$
    );
  end if;
end$$;

-- Backfill: migrate existing agent_history JSONB from members.settings into
-- the new table so no one loses their current conversation context.
-- Each entry in the JSONB array becomes a row; created_at is approximated
-- (1-second intervals so ordering is preserved).
do $$
declare
  rec         record;
  entry       jsonb;
  entry_index integer;
  base_time   timestamptz;
begin
  for rec in
    select id, rep_id, settings
    from members
    where settings ? 'agent_history'
      and jsonb_typeof(settings->'agent_history') = 'array'
      and jsonb_array_length(settings->'agent_history') > 0
  loop
    -- Use a base timestamp 1 hour before now; each entry gets +1 second so
    -- they sort in the correct conversational order.
    base_time := now() - interval '1 hour';
    entry_index := 0;

    for entry in select * from jsonb_array_elements(rec.settings->'agent_history')
    loop
      -- Skip if already migrated (idempotent re-run guard).
      if not exists (
        select 1 from agent_history
        where member_id = rec.id
          and role = (entry->>'role')
          and content = (entry->>'content')
      ) then
        insert into agent_history (member_id, rep_id, role, content, listed_tasks, created_at)
        values (
          rec.id,
          rec.rep_id,
          entry->>'role',
          entry->>'content',
          entry->'listed_tasks',
          base_time + (entry_index * interval '1 second')
        );
      end if;
      entry_index := entry_index + 1;
    end loop;
  end loop;
end$$;
