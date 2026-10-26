-- Ciao reply formatting step (Nick 2026-10-26): the layout an answer is drawn
-- in (words, number tiles, a table, a chart, steps or a callout), stored on
-- the assistant turn in agent_history so a chat reopened later draws the same.
-- Shape: { v, format, say, blocks, after, meta: { via, format, reason?, ms? } };
-- a refused or skipped layout stores only { meta }. `content` keeps the answer
-- exactly as written either way.
-- Written by app/api/mira/ask (lib/agent/replyFormatter). Until this runs, the
-- route saves turns without it and history reads without it.
--
-- Suite CXO DB ndschjbuyjmxtzqyjgyi. Safe to run more than once.

alter table public.agent_history add column if not exists reply_format jsonb;

notify pgrst, 'reload schema';
