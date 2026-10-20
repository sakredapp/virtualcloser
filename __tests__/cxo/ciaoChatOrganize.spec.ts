/**
 * The Ciao screen's list tools (owner 2026-10-20): folders, pin, rename and
 * soft delete, scoped to the signed-in member; the list before and after the
 * migration; and fenced code blocks in answers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── A small in-memory stand-in for the Supabase query builder ──────────────
type Row = Record<string, unknown>
const db: { tables: Record<string, Row[]>; columns: Record<string, string[]> } = { tables: {}, columns: {} }
let seq = 0
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  const fcols: string[] = []
  let op: 'select' | 'update' | 'insert' | 'delete' = 'select'
  let cols = '*'
  let patch: Row = {}
  let inserted: Row | null = null
  let limit = Infinity
  let order: { col: string; asc: boolean } | null = null
  const fail = (code: string, message: string) => ({ data: null, error: { code, message } })
  const pick = (r: Row) => {
    if (cols === '*') return { ...r }
    return Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, r[c] ?? null]))
  }
  const run = () => {
    if (!(table in db.tables)) return fail('42P01', `relation "${table}" does not exist`)
    const known = db.columns[table]
    const used = [...(cols === '*' ? [] : cols.split(',').map((c) => c.trim())), ...Object.keys(patch), ...fcols]
    const unknown = used.find((c) => !known.includes(c))
    if (unknown) return fail('42703', `column ${table}.${unknown} does not exist`)
    const rows = db.tables[table]
    if (op === 'insert') {
      const row = { id: uuid(), created_at: new Date().toISOString(), ...inserted! }
      rows.push(row)
      return { data: [pick(row)], error: null }
    }
    let hit = rows.filter((r) => filters.every((f) => f(r)))
    if (op === 'update') {
      hit.forEach((r) => Object.assign(r, patch))
      return { data: hit.map(pick), error: null }
    }
    if (op === 'delete') {
      db.tables[table] = rows.filter((r) => !hit.includes(r))
      return { data: null, error: null }
    }
    if (order) {
      const { col, asc } = order
      hit = [...hit].sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : asc ? 1 : -1))
    }
    return { data: hit.slice(0, limit).map(pick), error: null }
  }
  const b = {
    select(c = '*') { cols = c; return b },
    update(p: Row) { op = 'update'; patch = p; return b },
    insert(r: Row) { op = 'insert'; inserted = r; return b },
    delete() { op = 'delete'; return b },
    eq(c: string, v: unknown) { fcols.push(c); filters.push((r) => r[c] === v); return b },
    is(c: string, v: unknown) { fcols.push(c); filters.push((r) => (r[c] ?? null) === v); return b },
    in(c: string, vs: unknown[]) { fcols.push(c); filters.push((r) => vs.includes(r[c])); return b },
    order(col: string, o?: { ascending?: boolean }) { order = { col, asc: o?.ascending !== false }; return b },
    limit(n: number) { limit = n; return b },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej) },
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => query(t) } }))

import { organize, parseOrganize, listFolders, cleanName, type OrganizeAction } from '@/lib/agent/chatOrganize'
import { listConversationsRich, ownConversation } from '@/lib/agent/chatSessions'
import { parseMarkdown } from '@/lib/markdown'

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const REP = 'rep-1'
const C1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const C2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const THEIRS = 'aaaaaaaa-0000-4000-8000-000000000003'

const CONV_BASE = ['id', 'rep_id', 'member_id', 'started_at', 'last_at']
const CONV_NEW = [...CONV_BASE, 'title', 'pinned_at', 'folder_id', 'deleted_at']

function seed(migrated: boolean) {
  seq = 0
  db.tables = {
    ciao_conversations: [
      { id: C1, rep_id: REP, member_id: ME, started_at: '2026-10-18T10:00:00Z', last_at: '2026-10-18T11:00:00Z' },
      { id: C2, rep_id: REP, member_id: ME, started_at: '2026-10-19T10:00:00Z', last_at: '2026-10-19T11:00:00Z' },
      { id: THEIRS, rep_id: REP, member_id: OTHER, started_at: '2026-10-19T09:00:00Z', last_at: '2026-10-19T09:30:00Z' },
    ],
    agent_history: [
      { member_id: ME, role: 'user', conversation_id: C1, content: 'How is revenue?', created_at: '2026-10-18T10:00:00Z' },
      { member_id: ME, role: 'user', conversation_id: C2, content: 'Who is behind   on targets?', created_at: '2026-10-19T10:00:00Z' },
      { member_id: OTHER, role: 'user', conversation_id: THEIRS, content: 'Secret question', created_at: '2026-10-19T09:00:00Z' },
    ],
  }
  db.columns = {
    ciao_conversations: migrated ? CONV_NEW : CONV_BASE,
    agent_history: ['member_id', 'role', 'conversation_id', 'content', 'created_at'],
  }
  if (migrated) {
    db.tables.ciao_chat_folders = [{ id: 'ffffffff-0000-4000-8000-0000000000aa', rep_id: REP, member_id: OTHER, name: 'Theirs', created_at: '2026-10-01T00:00:00Z' }]
    db.columns.ciao_chat_folders = ['id', 'rep_id', 'member_id', 'name', 'created_at']
  }
}

const act = (body: Record<string, unknown>) => {
  const a = parseOrganize(body)
  if ('ok' in a) throw new Error(`bad action: ${JSON.stringify(a)}`)
  return organize(REP, ME, a as OrganizeAction)
}

describe('parseOrganize checks every request', () => {
  it('rejects unknown actions, bad ids and blank folder names', () => {
    expect(parseOrganize(null)).toMatchObject({ ok: false, status: 400 })
    expect(parseOrganize({ action: 'drop_table' })).toMatchObject({ ok: false, status: 400 })
    expect(parseOrganize({ action: 'pin_chat', id: 'not-a-uuid' })).toMatchObject({ ok: false, status: 400 })
    expect(parseOrganize({ action: 'create_folder', name: '   ' })).toMatchObject({ ok: false, status: 400, message: 'Give the folder a name.' })
    expect(parseOrganize({ action: 'move_chat', id: C1, folder_id: 'nope' })).toMatchObject({ ok: false, status: 400 })
  })
  it('cleans names and reads null / empty folder as "back to Recent"', () => {
    expect(cleanName('  Q4\n  board   prep ', 40)).toBe('Q4 board prep')
    expect(cleanName('x'.repeat(90), 80)).toHaveLength(80)
    expect(parseOrganize({ action: 'move_chat', id: C1, folder_id: null })).toEqual({ action: 'move_chat', id: C1, folder_id: null })
    expect(parseOrganize({ action: 'move_chat', id: C1, folder_id: '' })).toEqual({ action: 'move_chat', id: C1, folder_id: null })
    expect(parseOrganize({ action: 'pin_chat', id: C1, pinned: false })).toEqual({ action: 'pin_chat', id: C1, pinned: false })
    expect(parseOrganize({ action: 'rename_chat', id: C1, title: '' })).toEqual({ action: 'rename_chat', id: C1, title: '' })
  })
})

describe('before the folders migration', () => {
  beforeEach(() => seed(false))
  it('the list still loads, with organize off and no pins or folders', async () => {
    const r = await listConversationsRich(ME)
    expect(r.organize).toBe(false)
    expect(r.chats.map((c) => c.id)).toEqual([C2, C1])
    expect(r.chats[0]).toEqual({ id: C2, last_at: '2026-10-19T11:00:00Z', title: 'Who is behind on targets?' })
    expect(await listFolders(ME)).toBeNull()
  })
  it('every action answers a clear 503 not_ready', async () => {
    expect(await act({ action: 'pin_chat', id: C1 })).toMatchObject({ ok: false, status: 503, error: 'not_ready' })
    expect(await act({ action: 'create_folder', name: 'Board' })).toMatchObject({ ok: false, status: 503, error: 'not_ready' })
    expect(await act({ action: 'move_chat', id: C1, folder_id: 'ffffffff-0000-4000-8000-0000000000aa' })).toMatchObject({ status: 503 })
    expect(await act({ action: 'delete_folder', id: 'ffffffff-0000-4000-8000-0000000000aa' })).toMatchObject({ status: 503 })
  })
  it('a past chat still opens', async () => {
    expect(await ownConversation(ME, C1)).toMatchObject({ id: C1 })
  })
})

describe('after the folders migration', () => {
  beforeEach(() => seed(true))

  it('rename, pin and blank rename back to the first question', async () => {
    expect(await act({ action: 'rename_chat', id: C1, title: 'Revenue  check' })).toEqual({ ok: true })
    expect(await act({ action: 'pin_chat', id: C1, pinned: true })).toEqual({ ok: true })
    let r = await listConversationsRich(ME)
    expect(r.organize).toBe(true)
    expect(r.chats.find((c) => c.id === C1)).toMatchObject({ title: 'Revenue check', pinned: true, folder_id: null })
    await act({ action: 'rename_chat', id: C1, title: '  ' })
    r = await listConversationsRich(ME)
    expect(r.chats.find((c) => c.id === C1)?.title).toBe('How is revenue?')
  })

  it('someone else\'s chat or folder is not found, and is never changed', async () => {
    expect(await act({ action: 'rename_chat', id: THEIRS, title: 'Mine now' })).toMatchObject({ ok: false, status: 404, error: 'not_found' })
    expect(await act({ action: 'delete_chat', id: THEIRS })).toMatchObject({ status: 404 })
    expect(await act({ action: 'move_chat', id: C1, folder_id: 'ffffffff-0000-4000-8000-0000000000aa' })).toMatchObject({ status: 404, message: 'That folder was not found.' })
    expect(await act({ action: 'rename_folder', id: 'ffffffff-0000-4000-8000-0000000000aa', name: 'Mine' })).toMatchObject({ status: 404 })
    expect(await act({ action: 'delete_folder', id: 'ffffffff-0000-4000-8000-0000000000aa' })).toMatchObject({ status: 404 })
    expect(db.tables.ciao_conversations.find((c) => c.id === THEIRS)).not.toHaveProperty('title')
    expect(db.tables.ciao_chat_folders).toHaveLength(1)
    // Their folder never shows in my list either.
    expect(await listFolders(ME)).toEqual([])
  })

  it('folders: create, move a chat in, rename, delete moves its chats back to Recent', async () => {
    const made = await act({ action: 'create_folder', name: ' Board  prep ' })
    expect(made).toMatchObject({ ok: true, folder: { name: 'Board prep' } })
    const fid = (made as { folder: { id: string } }).folder.id
    expect(db.tables.ciao_chat_folders.find((f) => f.id === fid)).toMatchObject({ member_id: ME, rep_id: REP })

    expect(await act({ action: 'move_chat', id: C2, folder_id: fid })).toEqual({ ok: true })
    expect((await listConversationsRich(ME)).chats.find((c) => c.id === C2)?.folder_id).toBe(fid)

    expect(await act({ action: 'rename_folder', id: fid, name: 'Q4 board' })).toMatchObject({ ok: true, folder: { id: fid, name: 'Q4 board' } })
    expect((await listFolders(ME))?.map((f) => f.name)).toEqual(['Q4 board'])

    expect(await act({ action: 'delete_folder', id: fid })).toEqual({ ok: true })
    expect(await listFolders(ME)).toEqual([])
    const after = await listConversationsRich(ME)
    // The chat is still there, back in Recent.
    expect(after.chats.map((c) => c.id)).toEqual([C2, C1])
    expect(after.chats.find((c) => c.id === C2)?.folder_id).toBeNull()
  })

  it('delete is soft: the chat leaves the list and cannot be opened, its turns stay', async () => {
    await act({ action: 'pin_chat', id: C1 })
    expect(await act({ action: 'delete_chat', id: C1 })).toEqual({ ok: true, deleted_chat: C1 })
    expect((await listConversationsRich(ME)).chats.map((c) => c.id)).toEqual([C2])
    expect(await ownConversation(ME, C1)).toBeNull()
    expect(db.tables.ciao_conversations.find((c) => c.id === C1)).toMatchObject({ pinned_at: null })
    expect(db.tables.agent_history.some((h) => h.conversation_id === C1)).toBe(true)
    // Already deleted: nothing more to do to it.
    expect(await act({ action: 'rename_chat', id: C1, title: 'x' })).toMatchObject({ status: 404 })
  })
})

describe('answers: fenced code blocks', () => {
  it('keeps the code exactly, with its language, and parses around it', () => {
    const b = parseMarkdown('Run this:\n\n```SQL\nselect *\n  from t -- **not bold**\n```\n\n- after')
    expect(b).toEqual([
      { t: 'para', lines: [[{ t: 'text', v: 'Run this:' }]] },
      { t: 'code', lang: 'sql', code: 'select *\n  from t -- **not bold**' },
      { t: 'list', ordered: false, items: [{ text: [{ t: 'text', v: 'after' }], depth: 0 }] },
    ])
  })
  it('an unclosed fence runs to the end; ~~~ fences and no language work', () => {
    expect(parseMarkdown('```\na | b\n|--|--|')).toEqual([{ t: 'code', lang: '', code: 'a | b\n|--|--|' }])
    expect(parseMarkdown('~~~\n# not a heading\n~~~')).toEqual([{ t: 'code', lang: '', code: '# not a heading' }])
  })
  it('inline `code` is still inline', () => {
    expect(parseMarkdown('Use `npm test` here')[0]).toEqual({ t: 'para', lines: [[{ t: 'text', v: 'Use ' }, { t: 'code', v: 'npm test' }, { t: 'text', v: ' here' }]] })
  })
})
