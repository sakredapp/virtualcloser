-- Ciao speed on the real Pinnacle book (Suite CXO QA, 2026-10-18).
--
-- cxo_producer_rows: every producer row for one window as ONE jsonb value, so
-- the app reads a window in a single round trip. PostgREST caps a response at
-- 1,000 rows; the old read paged with .range(), which re-ran the producer
-- function once per page (and each page ran under a generic plan that took
-- ~6 s on the real book). A scalar jsonb is one row: no cap, no paging.
--
-- Each element is a compact array in this order:
--   [label, team, premium, funded, policies, paid, declined, lapsed, pending,
--    first_policy, contracted_at, status]
-- (lib/book/data.ts PRODUCER_ROW_KEYS). Read only, service_role only.
-- Idempotent. Run in the SuiteCXO project (ndschjbuyjmxtzqyjgyi) after
-- cxo_producer_book.sql.
create or replace function public.cxo_producer_rows(
  p_source text, p_rep_id text, p_line text, p_start date, p_end date, p_name text default null
)
returns jsonb
language plpgsql stable
set search_path = public
as $fn$
declare out jsonb;
begin
  if p_source = 'pinnacle' then
    select coalesce(jsonb_agg(jsonb_build_array(x.label, x.team, x.premium, x.funded, x.policies, x.paid, x.declined, x.lapsed,
      x.pending, x.first_policy, x.contracted_at, x.status)), '[]'::jsonb)
    into out
    from public.pinnacle_producer_production(p_line, p_start, p_end, p_name, 20000) x;
  else
    select coalesce(jsonb_agg(jsonb_build_array(x.label, x.team, x.premium, x.funded, x.policies, x.paid, x.declined, x.lapsed,
      x.pending, x.first_policy, x.contracted_at, x.status)), '[]'::jsonb)
    into out
    from public.cxo_book_producer_production(p_rep_id, p_line, p_start, p_end, p_name, 20000) x;
  end if;
  return out;
end;
$fn$;
revoke all on function public.cxo_producer_rows(text, text, text, date, date, text) from public, anon, authenticated;
grant execute on function public.cxo_producer_rows(text, text, text, date, date, text) to service_role;
