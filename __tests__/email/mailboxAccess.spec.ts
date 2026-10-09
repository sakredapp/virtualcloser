/**
 * Owner 10-09 (security): the Inbox showed every Gmail thread in the
 * workspace, including a former member's shared mailbox. Member A must not
 * be able to list, read, draft, send, approve, snooze or dismiss member B's
 * threads, the old shared mailbox, or an inactive member's mail, through any
 * route; and the picker no longer offers "All" or "Shared".
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './fakeDb'

const T = 'rep_t'
const A = { id: 'mem-a', rep_id: T, email: 'a@pinnacle.test', role: 'admin', is_active: true, display_name: 'A', timezone: null }
const B = { id: 'mem-b', rep_id: T, email: 'b@pinnacle.test', role: 'member', is_active: true, display_name: 'B', timezone: null }
const O = { id: 'mem-o', rep_id: T, email: 'owner@pinnacle.test', role: 'owner', is_active: true, display_name: 'O', timezone: null }
const I = { id: 'mem-i', rep_id: T, email: 'gone@pinnacle.test', role: 'admin', is_active: false, display_name: 'I', timezone: null }
const N = { id: 'mem-n', rep_id: T, email: 'new@pinnacle.test', role: 'admin', is_active: true, display_name: 'N', timezone: null }

function seed() {
  return {
    members: [A, B, O, I, N].map((m) => ({ ...m })),
    google_tokens: [
      { id: 'tok-a', rep_id: T, member_id: A.id, email: A.email, created_at: '2026-09-01T00:00:00Z' },
      { id: 'tok-b', rep_id: T, member_id: B.id, email: B.email, created_at: '2026-09-01T00:00:00Z' },
      { id: 'tok-i', rep_id: T, member_id: I.id, email: I.email, created_at: '2026-09-01T00:00:00Z' },
      // Tenant-level account the owner connected on 10-01.
      { id: 'tok-w', rep_id: T, member_id: null, email: O.email, created_at: '2026-10-01T00:00:00Z' },
    ],
    email_threads: [
      { id: 'th-a', rep_id: T, owner_member_id: A.id, gmail_thread_id: 'g-a', status: 'drafted', created_at: '2026-10-02T00:00:00Z', last_message_at: '2026-10-08', needs_reply: true, lead_id: null, subject: 'A mail' },
      { id: 'th-b', rep_id: T, owner_member_id: B.id, gmail_thread_id: 'g-b', status: 'drafted', created_at: '2026-10-02T00:00:00Z', last_message_at: '2026-10-08', needs_reply: true, lead_id: null, subject: 'B mail' },
      // The former member's shared mailbox: tenant-level, synced before the
      // current tenant-level account existed.
      { id: 'th-spencer', rep_id: T, owner_member_id: null, gmail_thread_id: 'g-s', status: 'drafted', created_at: '2026-05-01T00:00:00Z', last_message_at: '2026-10-07', needs_reply: true, lead_id: null, subject: 'Compensation levels' },
      { id: 'th-w', rep_id: T, owner_member_id: null, gmail_thread_id: 'g-w', status: 'drafted', created_at: '2026-10-03T00:00:00Z', last_message_at: '2026-10-06', needs_reply: true, lead_id: null, subject: 'Owner mail' },
      { id: 'th-i', rep_id: T, owner_member_id: I.id, gmail_thread_id: 'g-i', status: 'drafted', created_at: '2026-10-02T00:00:00Z', last_message_at: '2026-10-05', needs_reply: true, lead_id: null, subject: 'Inactive mail' },
      { id: 'th-other-tenant', rep_id: 'rep_x', owner_member_id: A.id, gmail_thread_id: 'g-x', status: 'drafted', created_at: '2026-10-02T00:00:00Z', last_message_at: '2026-10-05', needs_reply: true, lead_id: null, subject: 'Other tenant' },
    ],
    email_drafts: ['a', 'b', 'spencer', 'w', 'i'].map((k) => ({
      id: `dr-${k}`, rep_id: T, thread_id: `th-${k}`, status: 'pending', subject: `Re ${k}`, body: `body ${k}`, created_at: '2026-10-08', edited_by_human: false,
      owner_member_id: k === 'a' ? A.id : k === 'b' ? B.id : k === 'i' ? I.id : null,
    })),
    email_messages: [],
    outbound_messages: [],
  }
}

let db: FakeDb
let viewer: typeof A = A

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => db.from(t) } }))
vi.mock('@/lib/tenant', () => ({
  requireMember: vi.fn(async () => ({ tenant: { id: T, tier: 'individual' }, member: viewer })),
}))
vi.mock('@/lib/claude', () => ({ generateText: vi.fn(async () => 'from:someone') }))

const google = vi.hoisted(() => ({
  getGmailThread: vi.fn(async (_r: string, _m: string | null, tid: string) => ({
    ok: true,
    messages: [{ id: `msg-${tid}`, labelIds: ['INBOX'], subject: 'hi', fromAddress: 'sender@x.test', messageIdHeader: '<m>', referencesHeader: null }],
  })),
  replyToGmailThread: vi.fn(async () => ({ ok: true, messageId: 'sent-1' })),
  markGmailRead: vi.fn(async () => ({ ok: true })),
  listGmailThreads: vi.fn(async () => ({ ok: true, threads: [] })),
  getGmailThreadMetadata: vi.fn(async () => ({ ok: false })),
}))
vi.mock('@/lib/google', () => google)

import {
  computeMailboxScope,
  getMailboxScope,
  getMailboxScopeById,
  loadThreadForMember,
  mailboxOptions,
  resolveMailbox,
} from '@/lib/email/mailboxAccess'
import { approveAllDrafts, approveDraft, dismissThread, listMailboxThreads, readMailboxThread, snoozeThread } from '@/lib/email/inbox'
import { pickSenderAccount } from '@/lib/partners'

const scopeOf = (m: typeof A) => getMailboxScope(T, m)
const threadStatus = (id: string) => db.tables.email_threads.find((t) => t.id === id)?.status
const draftStatus = (id: string) => db.tables.email_drafts.find((d) => d.id === id)?.status

beforeEach(() => {
  db = makeFakeDb(seed())
  viewer = A
  Object.values(google).forEach((f) => f.mockClear())
})

describe('who may see which mailbox', () => {
  it('a member sees only their own box; never B, never shared, never "All"', async () => {
    const s = await scopeOf(A)
    expect(s.mailboxes.map((m) => m.key)).toEqual([A.id])
    expect(resolveMailbox(s, B.id)).toBeNull()
    expect(resolveMailbox(s, 'shared')).toBeNull()
    expect(resolveMailbox(s, 'workspace')).toBeNull()
    expect(resolveMailbox(s, I.id)).toBeNull()
    // "all" no longer means everything: it falls back to their own box only.
    expect(resolveMailbox(s, 'all')?.key).toBe(A.id)
  })

  it('an inactive member sees nothing, and nobody else sees their mail', async () => {
    expect((await scopeOf(I)).mailboxes).toEqual([])
    for (const m of [A, B, O]) {
      expect(await loadThreadForMember(await scopeOf(m), 'th-i', 'id')).toBeNull()
    }
    // Same through the by-id loader Mira uses.
    expect((await getMailboxScopeById(T, I.id)).mailboxes).toEqual([])
  })

  it('a member with no Google connected has no mailbox (Connect state), even when a tenant-level account exists', async () => {
    const s = await scopeOf(N)
    expect(s.mailboxes).toEqual([])
    expect(resolveMailbox(s, '')).toBeNull()
    expect((await listMailboxThreads(s, null, 'active')).threads).toEqual([])
  })

  it('the tenant-level box belongs only to its owner, and only from when it was connected', async () => {
    const s = await scopeOf(O)
    expect(s.mailboxes.map((m) => m.key)).toEqual(['workspace'])
    const box = resolveMailbox(s, 'workspace')!
    const ids = (await listMailboxThreads(s, box, 'triage')).threads.map((t) => t.id)
    expect(ids).toEqual(['th-w'])
    expect(ids).not.toContain('th-spencer')
    expect(await loadThreadForMember(s, 'th-spencer', 'id')).toBeNull()
  })

  it('with no tenant-level token at all (the live case), the old shared mailbox is visible to nobody', async () => {
    db.tables.google_tokens = db.tables.google_tokens.filter((t) => t.member_id !== null)
    for (const m of [A, B, O, I, N]) {
      const s = await scopeOf(m)
      expect(s.mailboxes.some((b) => b.kind === 'workspace')).toBe(false)
      expect(await loadThreadForMember(s, 'th-spencer', 'id')).toBeNull()
      expect(await readMailboxThread(s, 'th-spencer')).toBeNull()
    }
  })

  it('a removed member row (another tenant, or deleted) gets nothing', () => {
    expect(computeMailboxScope(T, { ...A, rep_id: 'rep_x' }, db.tables.google_tokens as never).mailboxes).toEqual([])
    expect(computeMailboxScope(T, null, db.tables.google_tokens as never).mailboxes).toEqual([])
  })
})

describe('Inbox list / read', () => {
  it('lists only A\'s threads, for both tabs', async () => {
    const s = await scopeOf(A)
    for (const view of ['triage', 'active'] as const) {
      const ids = (await listMailboxThreads(s, resolveMailbox(s, ''), view)).threads.map((t) => t.id)
      expect(ids).toEqual(['th-a'])
    }
  })

  it('asking for B\'s or the shared mailbox lists nothing', async () => {
    const s = await scopeOf(A)
    for (const key of [B.id, 'shared', 'workspace', I.id]) {
      expect((await listMailboxThreads(s, resolveMailbox(s, key), 'triage')).threads).toEqual([])
    }
    // Even a hand-built box for B is refused: it is not in A's scope.
    const bBox = (await scopeOf(B)).mailboxes[0]
    expect((await listMailboxThreads(s, bBox, 'triage')).threads).toEqual([])
  })

  it('A cannot read B\'s, the shared, the inactive or another tenant\'s thread', async () => {
    const s = await scopeOf(A)
    for (const id of ['th-b', 'th-spencer', 'th-w', 'th-i', 'th-other-tenant']) {
      expect(await readMailboxThread(s, id)).toBeNull()
    }
    expect((await readMailboxThread(s, 'th-a'))?.thread.id).toBe('th-a')
  })
})

describe('Inbox actions', () => {
  it('A cannot approve/send B\'s or the shared mailbox\'s drafts', async () => {
    const s = await scopeOf(A)
    for (const [t, d] of [['th-b', 'dr-b'], ['th-spencer', 'dr-spencer'], ['th-w', 'dr-w'], ['th-i', 'dr-i']]) {
      expect(await approveDraft(s, t, d)).toEqual({ ok: false, reason: 'no_thread' })
      expect(draftStatus(d)).toBe('pending')
    }
    // A thread of A's paired with someone else's draft id: not found either.
    expect((await approveDraft(s, 'th-a', 'dr-b')).ok).toBe(false)
    expect(draftStatus('dr-b')).toBe('pending')
    expect(google.replyToGmailThread).not.toHaveBeenCalled()
    expect(google.getGmailThread).not.toHaveBeenCalled()
  })

  it('A can approve their own draft, sent from their own account', async () => {
    const s = await scopeOf(A)
    expect(await approveDraft(s, 'th-a', 'dr-a')).toEqual({ ok: true })
    expect(google.replyToGmailThread).toHaveBeenCalledTimes(1)
    expect((google.replyToGmailThread.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0][1]).toMatchObject({ accountId: 'tok-a', memberId: A.id })
    expect(draftStatus('dr-a')).toBe('sent')
  })

  it('"Approve & send all" only sends A\'s drafts, never the shared mailbox\'s 38', async () => {
    const s = await scopeOf(A)
    const r = await approveAllDrafts(s, resolveMailbox(s, ''))
    expect(r.sent).toBe(1)
    expect(google.replyToGmailThread).toHaveBeenCalledTimes(1)
    for (const d of ['dr-b', 'dr-spencer', 'dr-w', 'dr-i']) expect(draftStatus(d)).toBe('pending')
    // Pointed at a mailbox A doesn't own: sends nothing.
    google.replyToGmailThread.mockClear()
    expect(await approveAllDrafts(s, resolveMailbox(s, 'shared'))).toEqual({ sent: 0, skipped: 0 })
    expect(google.replyToGmailThread).not.toHaveBeenCalled()
  })

  it('a member with no Google can approve nothing', async () => {
    const s = await scopeOf(N)
    expect(await approveAllDrafts(s, resolveMailbox(s, ''))).toEqual({ sent: 0, skipped: 0 })
    expect((await approveDraft(s, 'th-spencer', 'dr-spencer')).ok).toBe(false)
    expect(google.replyToGmailThread).not.toHaveBeenCalled()
  })

  it('A cannot dismiss (archive) or snooze B\'s, shared or inactive threads', async () => {
    const s = await scopeOf(A)
    for (const id of ['th-b', 'th-spencer', 'th-w', 'th-i']) {
      expect(await dismissThread(s, id)).toBe(false)
      expect(await snoozeThread(s, id, 24)).toBe(false)
      expect(threadStatus(id)).toBe('drafted')
    }
    expect(db.writes).toEqual([])
    expect(await dismissThread(s, 'th-a')).toBe(true)
    expect(threadStatus('th-a')).toBe('dismissed')
  })
})

describe('search + live stream routes', () => {
  async function search(member: typeof A, body: Record<string, unknown>) {
    viewer = member
    const { POST } = await import('@/app/api/inbox/search/route')
    const req = { json: async () => body, nextUrl: new URL('https://x.test/api/inbox/search') }
    return POST(req as never)
  }

  it('403 for B\'s mailbox, "shared", "all"-less misuse, and for a member with no Google', async () => {
    expect((await search(A, { q: 'comp', account: B.id })).status).toBe(403)
    expect((await search(A, { q: 'comp', account: 'shared' })).status).toBe(403)
    expect((await search(A, { q: 'comp', account: 'workspace' })).status).toBe(403)
    expect((await search(N, { q: 'comp' })).status).toBe(403)
    expect((await search(I, { q: 'comp' })).status).toBe(403)
    expect(google.listGmailThreads).not.toHaveBeenCalled()
  })

  it('searches only the caller\'s own Gmail account', async () => {
    const res = await search(A, { q: 'comp' })
    expect(res.status).toBe(200)
    expect(google.listGmailThreads).toHaveBeenCalled()
    for (const call of google.listGmailThreads.mock.calls as unknown as Array<[string, string | null, { accountId?: string }]>) {
      expect(call[2].accountId).toBe('tok-a')
    }
  })

  it('the live stream refuses a member with no mailbox', async () => {
    viewer = N
    const { GET } = await import('@/app/api/inbox/stream/route')
    expect((await GET({} as never)).status).toBe(403)
  })
})

describe('Mira + MCP email tools (pickSenderAccount)', () => {
  it('only ever returns the caller\'s own account', async () => {
    const a = await pickSenderAccount(T, A.id)
    expect(a.account?.accountId).toBe('tok-a')
    expect(a.choices.map((c) => c.accountId)).toEqual(['tok-a'])
    // Asking for B's or the owner's address by email does not switch to it.
    expect((await pickSenderAccount(T, A.id, B.email)).account?.accountId).toBe('tok-a')
    expect((await pickSenderAccount(T, A.id, O.email)).account?.accountId).toBe('tok-a')
  })

  it('no Google of their own, or inactive: nothing (never the workspace account)', async () => {
    expect((await pickSenderAccount(T, N.id)).account).toBeNull()
    expect((await pickSenderAccount(T, I.id)).account).toBeNull()
    expect((await pickSenderAccount(T, null)).account).toBeNull()
  })
})

describe('the picker', () => {
  it('offers only the member\'s own mailboxes: no All, no Shared', async () => {
    for (const m of [A, B, O, N]) {
      const opts = mailboxOptions(await scopeOf(m))
      expect(opts.map((o) => o.key)).not.toContain('all')
      expect(opts.map((o) => o.key)).not.toContain('shared')
      expect(opts.every((o) => o.key === m.id || o.key === 'workspace')).toBe(true)
      expect(opts.some((o) => /all inboxes|shared/i.test(o.label))).toBe(false)
    }
  })

  it('the switcher component and the page have no All/Shared option left', () => {
    const root = path.resolve(__dirname, '../..')
    const sw = readFileSync(path.join(root, 'app/dashboard/inbox/AccountSwitcher.tsx'), 'utf8')
    expect(sw).not.toMatch(/value="all"/)
    expect(sw).not.toMatch(/All inboxes/)
    const page = readFileSync(path.join(root, 'app/dashboard/inbox/page.tsx'), 'utf8')
    expect(page).not.toMatch(/listConnectedGoogleAccounts/)
    expect(page).not.toMatch(/'shared'/)
    expect(page).not.toMatch(/\|\| 'all'/)
  })
})
