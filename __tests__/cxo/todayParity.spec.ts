import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from '../email/fakeDb'

let db: FakeDb
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => db.from(t) },
}))

import { isDoneListTitle, placeCards, updateCard } from '@/lib/boards'
import { threadNeedsReply } from '@/lib/email/needsReply'

const REP = 'rep_x'
const lists = () => [
  { id: 'todo', board_id: 'b1', rep_id: REP, title: 'To do', position: 0 },
  { id: 'doing', board_id: 'b1', rep_id: REP, title: 'In progress', position: 1 },
  { id: 'done', board_id: 'b1', rep_id: REP, title: 'Done', position: 2 },
]
const card = (id: string, list_id: string, done_at: string | null = null) => ({ id, board_id: 'b1', rep_id: REP, list_id, position: 0, done_at })
const row = (id: string) => db.tables.cxo_board_cards.find((c) => c.id === id)!

describe('board done-sync (Today strip and Boards columns agree)', () => {
  beforeEach(() => {
    db = makeFakeDb({ cxo_board_lists: lists(), cxo_board_cards: [card('c1', 'doing'), card('c2', 'done', '2026-10-01T00:00:00Z')] })
  })

  it('knows a done list by its title', () => {
    expect(isDoneListTitle('Done')).toBe(true)
    expect(isDoneListTitle(' completed ')).toBe(true)
    expect(isDoneListTitle('In progress')).toBe(false)
    expect(isDoneListTitle(null)).toBe(false)
  })

  it('Mark done moves the card into the Done list', async () => {
    await updateCard(REP, 'c1', { done: true })
    expect(row('c1').list_id).toBe('done')
    expect(row('c1').done_at).toBeTruthy()
  })

  it('Reopen moves it back to the first open list', async () => {
    await updateCard(REP, 'c2', { done: false })
    expect(row('c2').list_id).toBe('todo')
    expect(row('c2').done_at).toBeNull()
  })

  it('dragging into Done stamps done; dragging out clears it', async () => {
    await placeCards(REP, 'done', ['c1'])
    expect(row('c1').list_id).toBe('done')
    expect(row('c1').done_at).toBeTruthy()
    await placeCards(REP, 'todo', ['c1'])
    expect(row('c1').list_id).toBe('todo')
    expect(row('c1').done_at).toBeNull()
  })
})

describe('needs-reply rule matches the Inbox bucket', () => {
  it('counts new/triaged, needs a reply, not noise', () => {
    expect(threadNeedsReply({ status: 'new', needs_reply: true, priority: null })).toBe(true)
    expect(threadNeedsReply({ status: 'triaged', needs_reply: true, priority: 'high' })).toBe(true)
    expect(threadNeedsReply({ status: 'triaged', needs_reply: true, priority: 'noise' })).toBe(false)
    expect(threadNeedsReply({ status: 'drafted', needs_reply: true, priority: null })).toBe(false)
    expect(threadNeedsReply({ status: 'new', needs_reply: false, priority: null })).toBe(false)
  })
})
