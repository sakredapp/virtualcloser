-- agent_usage records which model ran and what it cost (GLM on OpenRouter vs
-- Sonnet). Safe to re-run. Until it runs, lib/agent/runAgent.ts falls back to
-- the old 7-argument agent_usage_increment, so usage logging never breaks.
alter table agent_usage add column if not exists model text;
alter table agent_usage add column if not exists est_cost_usd numeric(12,6) not null default 0;

-- Replace (not overload) so PostgREST never sees two candidates for one call.
drop function if exists agent_usage_increment(text, uuid, date, int, int, int, int);
create or replace function agent_usage_increment(
  p_rep_id text,
  p_member_id uuid,
  p_day date,
  p_input_tokens int default 0,
  p_output_tokens int default 0,
  p_tool_calls int default 0,
  p_errors int default 0,
  p_model text default null,
  p_est_cost_usd numeric default 0
) returns int as $$
declare new_count int;
begin
  insert into agent_usage (rep_id, member_id, day, requests, input_tokens, output_tokens, tool_calls, errors, model, est_cost_usd)
    values (p_rep_id, p_member_id, p_day, 1, p_input_tokens, p_output_tokens, p_tool_calls, p_errors, p_model, coalesce(p_est_cost_usd, 0))
  on conflict (rep_id, member_id, day) do update
    set requests      = agent_usage.requests      + 1,
        input_tokens  = agent_usage.input_tokens  + p_input_tokens,
        output_tokens = agent_usage.output_tokens + p_output_tokens,
        tool_calls    = agent_usage.tool_calls    + p_tool_calls,
        errors        = agent_usage.errors        + p_errors,
        model         = coalesce(p_model, agent_usage.model),
        est_cost_usd  = agent_usage.est_cost_usd  + coalesce(p_est_cost_usd, 0),
        updated_at    = now()
  returning requests into new_count;
  return new_count;
end;
$$ language plpgsql;
