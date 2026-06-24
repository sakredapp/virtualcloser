-- Enable Row Level Security on the 5 tables flagged by the Supabase advisor
-- (RLS disabled = fully exposed to the anon + authenticated roles).
--
-- Pattern: enable RLS with NO policies. The application reads/writes only
-- through the service-role key (lib/supabase.ts proxy + the direct
-- service-role client in app/api/inbox/stream/route.ts), which bypasses RLS
-- entirely. anon / authenticated should have no access at all to these
-- tables. This is the SAME pattern every other table in the schema already
-- uses (the advisor only flagged tables where RLS was disabled).
--
-- Verified before writing this:
--   - lib/supabase.ts builds its client with SUPABASE_SERVICE_ROLE_KEY.
--   - app/api/inbox/stream/route.ts is the only other createClient call —
--     it also uses SUPABASE_SERVICE_ROLE_KEY.
--   - grep for NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY across
--     lib/ + app/ returns zero hits.
--
-- Review and run manually — this is not wired into a migration runner. It
-- is non-destructive (no rows touched, schema unchanged); the only effect
-- is that the anon + authenticated roles stop being able to read or write
-- these tables. If a future client-side flow ever needs direct table access
-- under the anon key, add a targeted policy at that time.

begin;

-- rep_contacts: per-tenant contact directory surfaced from Plaud notes
-- (rep_id-scoped). Read/write only via lib/plaud/directory.ts +
-- /api/plaud/contacts. No client-side reads.
alter table public.rep_contacts enable row level security;

-- plaud_actions: action items the Plaud agent extracts from a note (rep_id-
-- scoped). Server-side mutations only via /api/plaud/actions/[id]/*.
alter table public.plaud_actions enable row level security;

-- rate_limit_buckets: per-key fixed-window counters used by lib/rateLimit.ts
-- (called via supabase.rpc('enforce_rate_limit',…), still under service-
-- role). Never read client-side.
alter table public.rate_limit_buckets enable row level security;

-- app_errors: structured error log written by lib/errors.ts; surfaced only
-- on the admin-gated /admin/errors page. Never read by anon clients.
alter table public.app_errors enable row level security;

-- plaud_settings: per-rep configuration for the Plaud agent tick
-- (lib/plaud/agentTick.ts). Server-only.
alter table public.plaud_settings enable row level security;

commit;

-- Post-run sanity (run separately, expect all 5 rows to show rls_enabled=t):
--   select relname, relrowsecurity
--     from pg_class
--    where relname in (
--      'rep_contacts','plaud_actions','rate_limit_buckets','app_errors','plaud_settings'
--    );
--   -- And confirm zero policies (intentional — service-role bypasses):
--   select tablename, policyname from pg_policies
--    where tablename in (
--      'rep_contacts','plaud_actions','rate_limit_buckets','app_errors','plaud_settings'
--    );
