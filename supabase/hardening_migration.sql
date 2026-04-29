-- Hardening migration — run AFTER kpi_cards_migration.sql + schema.sql.
--
-- 1. Create the three private storage buckets the app expects (idempotent).
--    Without these, file uploads to Supabase Storage 500.
--
-- 2. Enable Row-Level Security on KPI + feature_request tables. The
--    application uses the service-role key (which bypasses RLS), so this is
--    defense-in-depth for any future client-side access path.

-- ── Storage buckets (idempotent) ────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values
  ('roleplay-training', 'roleplay-training', false),
  ('roleplay-audio',    'roleplay-audio',    false),
  ('voice-memos',       'voice-memos',       false)
on conflict (id) do nothing;

-- ── RLS on KPI tables ──────────────────────────────────────────────────────
-- Service-role queries bypass RLS so the app keeps working. We add policies
-- that *would* gate per-tenant access if anyone ever wired the anon key into
-- a client-side query — defense-in-depth only.

alter table if exists kpi_cards         enable row level security;
alter table if exists kpi_entries       enable row level security;
alter table if exists feature_requests  enable row level security;

-- Tenant-scoped read policy for kpi_cards. Assumes a JWT claim `rep_id`
-- on the auth token (Supabase Auth → custom claim) — adjust if your auth
-- shape is different. Service role bypasses regardless.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'kpi_cards' and policyname = 'kpi_cards_tenant_read'
  ) then
    create policy kpi_cards_tenant_read on kpi_cards
      for select using (rep_id = current_setting('request.jwt.claims', true)::jsonb->>'rep_id');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'kpi_entries' and policyname = 'kpi_entries_tenant_read'
  ) then
    create policy kpi_entries_tenant_read on kpi_entries
      for select using (rep_id = current_setting('request.jwt.claims', true)::jsonb->>'rep_id');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feature_requests' and policyname = 'feature_requests_tenant_read'
  ) then
    create policy feature_requests_tenant_read on feature_requests
      for select using (rep_id = current_setting('request.jwt.claims', true)::jsonb->>'rep_id');
  end if;
end$$;
