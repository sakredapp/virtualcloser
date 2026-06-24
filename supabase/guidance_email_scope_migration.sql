-- Extend the Plaud guidance store to cover email-drafting style rules.
--
-- The guidance store (plaud_agent_guidance) already learns durable rules for the
-- note-agent + daily planner. This adds an 'email' scope so the same
-- learn-once-apply-forever loop covers email replies: a "make it shorter/warmer"
-- regenerate becomes a standing rule that draftEmailReply reads on every future
-- draft, instead of a per-thread style note that's forgotten immediately.

alter table plaud_agent_guidance drop constraint if exists plaud_agent_guidance_scope_check;
alter table plaud_agent_guidance
  add constraint plaud_agent_guidance_scope_check
  check (scope in ('note_agent', 'planner', 'both', 'email'));
