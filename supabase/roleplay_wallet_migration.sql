-- Roleplay wallet migration — brings the live DB up to what
-- lib/roleplay-engine.ts writes, and adds the AI-wallet billing rails.
--
-- Two halves:
--   1. roleplay_sessions catch-up — the table pre-dates the standalone tool
--      (roleplay.virtualcloser.com) and is missing every call-bind column the
--      engine writes, and scenario_id is NOT NULL while built-in personas
--      insert without one.
--   2. AI wallet — ai_wallets / ai_wallet_ledger + an atomic charge function.
--      Practice is a micro-purchase: $/min drawn from the account wallet at
--      session finalize (see lib/roleplay-billing.ts). One charge per session,
--      enforced by a partial unique index, so a retried finalize never
--      double-bills.
--
-- Idempotent. Run in the SuiteCXO Supabase project (ndschjbuyjmxtzqyjgyi).

-- ── 1. roleplay_sessions catch-up ───────────────────────────────────────────
alter table roleplay_sessions alter column scenario_id drop not null;
alter table roleplay_sessions
  add column if not exists scenario_key     text,
  add column if not exists transport        text not null default 'browser',
  add column if not exists agent_id         text,
  add column if not exists agent_number     text,
  add column if not exists provider_call_id text,
  add column if not exists bind_note        text,
  add column if not exists requested_at     timestamptz not null default now(),
  add column if not exists dialed_at        timestamptz;

-- One provider call grades exactly one session — the DB-level backstop
-- against a cross-account transcript landing under the wrong rep.
create unique index if not exists roleplay_sessions_provider_call_id_key
  on roleplay_sessions (provider_call_id);

-- ── 2. AI wallet ────────────────────────────────────────────────────────────
create table if not exists ai_wallets (
  rep_id        text primary key references reps(id) on delete cascade,
  balance_cents integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table ai_wallets enable row level security;

create table if not exists ai_wallet_ledger (
  id           uuid primary key default gen_random_uuid(),
  rep_id       text not null references reps(id) on delete cascade,
  member_id    uuid references members(id) on delete set null,
  kind         text not null check (kind in ('deposit','adjustment','roleplay_practice')),
  -- Signed: deposits positive, charges negative. balance is the running sum.
  amount_cents integer not null,
  session_id   uuid references roleplay_sessions(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists ai_wallet_ledger_rep_idx
  on ai_wallet_ledger (rep_id, created_at desc);
-- One practice charge per session, ever. ON CONFLICT in the charge function
-- infers this index, which is what makes a retried finalize a no-op.
create unique index if not exists ai_wallet_ledger_session_charge_key
  on ai_wallet_ledger (session_id) where kind = 'roleplay_practice';
alter table ai_wallet_ledger enable row level security;

-- Atomic charge: ledger row + balance decrement in one transaction, no-op on
-- a session that was already charged. Returns the wallet balance after.
create or replace function roleplay_wallet_charge(
  p_rep_id       text,
  p_member_id    uuid,
  p_session_id   uuid,
  p_amount_cents integer,
  p_note         text
) returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_amount  integer := -abs(p_amount_cents);
  v_balance integer;
begin
  insert into ai_wallets (rep_id) values (p_rep_id)
  on conflict (rep_id) do nothing;

  insert into ai_wallet_ledger (rep_id, member_id, kind, amount_cents, session_id, note)
  values (p_rep_id, p_member_id, 'roleplay_practice', v_amount, p_session_id, p_note)
  on conflict (session_id) where kind = 'roleplay_practice' do nothing;

  if found then
    update ai_wallets
       set balance_cents = balance_cents + v_amount, updated_at = now()
     where rep_id = p_rep_id
    returning balance_cents into v_balance;
  else
    select balance_cents into v_balance from ai_wallets where rep_id = p_rep_id;
  end if;

  return coalesce(v_balance, 0);
end
$$;

-- All access is server-side through the service role. Tables created over a
-- direct postgres connection do NOT get Supabase's default grants, so state
-- them — and prove them, RAISE not WARN.
grant select, insert, update on ai_wallets to service_role;
grant select, insert on ai_wallet_ledger to service_role;
grant execute on function roleplay_wallet_charge(text, uuid, uuid, integer, text) to service_role;

do $$
begin
  if not has_table_privilege('service_role', 'ai_wallets', 'select, insert, update') then
    raise exception 'ai_wallets grants missing for service_role';
  end if;
  if not has_table_privilege('service_role', 'ai_wallet_ledger', 'select, insert') then
    raise exception 'ai_wallet_ledger grants missing for service_role';
  end if;
  if not has_function_privilege('service_role', 'roleplay_wallet_charge(text, uuid, uuid, integer, text)', 'execute') then
    raise exception 'roleplay_wallet_charge execute missing for service_role';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_name = 'roleplay_sessions' and column_name = 'scenario_id' and is_nullable = 'NO'
  ) then
    raise exception 'roleplay_sessions.scenario_id is still NOT NULL';
  end if;
end $$;
