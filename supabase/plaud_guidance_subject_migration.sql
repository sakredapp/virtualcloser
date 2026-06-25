-- Per-relationship memory: tag a learned rule with WHO it's about, so the
-- assistant accumulates knowledge of the exec's world ("with the CFO,
-- numbers-first", "the board wants formal", "Maria prefers Slack") and applies
-- the right rule for whoever's in play. null subject = a general rule.

alter table plaud_agent_guidance add column if not exists subject text;
