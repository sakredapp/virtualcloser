-- Ciao answer check (owner 2026-10-19): per-answer metadata on the assistant
-- turn in agent_history: { checked, revised, reason?, issues?, ms? }.
-- Written by app/api/mira/ask (lib/agent/answerCheck). Until this runs, the
-- route saves turns without it (it retries the insert without the column).
--
-- Suite CXO DB ndschjbuyjmxtzqyjgyi. Safe to run more than once.

alter table public.agent_history add column if not exists answer_check jsonb;

notify pgrst, 'reload schema';
