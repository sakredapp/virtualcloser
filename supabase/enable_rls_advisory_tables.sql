-- Enable Row Level Security on the 10 tables that the Supabase advisory
-- flagged as RLS-disabled. Applied to prod 2026-05-18 via Supabase MCP.
--
-- WHY ENABLE WITHOUT POLICIES:
-- All 57 code references to these tables go through the SERVICE ROLE client
-- in lib/supabase.ts (audited 2026-05-18). The service role bypasses RLS, so
-- enabling RLS without explicit policies blocks anon-key access only and
-- does not break any current functionality.
--
-- If/when any of these tables ever need to be read directly from the
-- browser (anon key), per-tenant policies will need to be added:
--   create policy <name> on <table>
--     for select using (rep_id = (auth.jwt() ->> 'rep_id')::text);
-- ...but we are NOT doing that opportunistically. Adding policies only when
-- there's an actual client-side read use case keeps the security surface
-- explicit.

alter table lead_events            enable row level security;
alter table sms_messages           enable row level security;
alter table lead_notes             enable row level security;
alter table local_presence_numbers enable row level security;
alter table import_batches         enable row level security;
alter table plaud_notes            enable row level security;
alter table lead_campaigns         enable row level security;
alter table rep_api_keys           enable row level security;
alter table lead_campaign_events   enable row level security;
alter table sms_ai_sessions        enable row level security;
