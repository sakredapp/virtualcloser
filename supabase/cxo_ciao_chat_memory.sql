-- Ciao chat memory (owner ask 2026-10-20; lib/agent/chatMemory + chatMemoryStore).
--  - ciao_conversations.summary / summary_through: the running summary of a
--    long chat's older messages, and the time of the last message it covers.
--  - agent_history.sources: on an answer row, a short digest of what that
--    answer read (tool, file / report / ids, first lines back), so a follow-up
--    can reuse it instead of fetching again.
-- Written by app/api/mira/ask. Until this runs the route reads and saves
-- without these columns.
--
-- Suite CXO DB ndschjbuyjmxtzqyjgyi. Additive only. Safe to run more than once.

alter table public.ciao_conversations add column if not exists summary text;
alter table public.ciao_conversations add column if not exists summary_through timestamptz;
alter table public.agent_history add column if not exists sources text;

notify pgrst, 'reload schema';
