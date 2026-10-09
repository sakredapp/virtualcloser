-- 2026-10-09 Boards rework: the starter board no longer seeds example cards.
-- Remove the two example cards from existing starter boards where nobody has
-- touched them (no notes, no assignees, no checklist).
delete from cxo_board_cards c
using cxo_boards b
where c.board_id = b.id
  and b.imported_from like 'starter%'
  and c.title in ('Add your first task', 'Assign a task to a partner')
  and coalesce(c.notes, '') = ''
  and not exists (select 1 from cxo_board_card_assignees a where a.card_id = c.id)
  and not exists (select 1 from cxo_board_checklist_items i where i.card_id = c.id)
returning c.id, c.rep_id, c.title;
