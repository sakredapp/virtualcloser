-- MCP tokens migration — "Connect your AI" for Suite CXO.
--
-- An executive creates a key on the Integrations page and pastes it into
-- their own Claude or ChatGPT. The key is shown ONCE; only its sha256 is
-- stored. app/api/mcp authenticates every call with it and scopes every tool
-- to the key's account (rep) and member.
--
-- Idempotent. Run in the SuiteCXO Supabase project (ndschjbuyjmxtzqyjgyi).

create table if not exists mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  rep_id       text not null references reps(id) on delete cascade,
  member_id    uuid references members(id) on delete set null,
  label        text not null default 'My AI',
  token_hash   text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- The lookup on every MCP call: hash -> live row.
create unique index if not exists mcp_tokens_token_hash_key on mcp_tokens (token_hash);
create index if not exists mcp_tokens_rep_idx on mcp_tokens (rep_id, created_at desc);

alter table mcp_tokens enable row level security;

-- All access is server-side through the service role. Tables created over a
-- direct postgres connection do NOT get Supabase's default grants, so state
-- them — and prove them, RAISE not WARN.
grant select, insert, update, delete on mcp_tokens to service_role;

do $$
begin
  if not has_table_privilege('service_role', 'mcp_tokens', 'select, insert, update, delete') then
    raise exception 'mcp_tokens grants missing for service_role';
  end if;
end $$;
