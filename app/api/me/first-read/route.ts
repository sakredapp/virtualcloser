/**
 * The first read (lib/firstRead): what the assistant learned from each Google
 * account the signed-in person may use.
 *   GET   → { reads }. An account with no read yet gets one now, in the
 *           background (covers accounts connected before this shipped).
 *   POST  { accountId? } → read again (that account, else all of theirs).
 *   PATCH { id, dismiss: true } → hide that read's card.
 * Scoped to the caller's own Google accounts (the same rule as Today and the
 * Inbox: lib/email/mailboxAccess). An assistant working as their exec sees none.
 */
import { NextResponse, after } from 'next/server'
import { requireOrgMember, NotExec } from '@/lib/cxoAccess'
import { getGoogleAccountScopeById } from '@/lib/email/mailboxAccess'
import { claimFirstRead, dismissFirstRead, listFirstReads, runFirstRead, type FirstReadRow } from '@/lib/firstRead/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Ctx = Awaited<ReturnType<typeof requireOrgMember>>
type Gate = { ctx: Ctx; accounts: Array<{ accountId: string; email: string | null }> } | { err: NextResponse }

async function gate(): Promise<Gate> {
  let ctx: Ctx
  try {
    ctx = await requireOrgMember()
  } catch (e) {
    if (e instanceof NotExec) return { err: NextResponse.json({ error: 'Executive suite only.' }, { status: 403 }) }
    return { err: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) }
  }
  if (ctx.member.acting_assistant) return { ctx, accounts: [] }
  const scope = await getGoogleAccountScopeById(ctx.tenant.id, ctx.member.id)
  return { ctx, accounts: scope.mailboxes.map((m) => ({ accountId: m.accountId, email: m.email })) }
}

function view(r: FirstReadRow) {
  return { id: r.id, accountId: r.account_id, email: r.google_email, status: r.status, summary: r.status === 'done' ? r.summary : null, error: r.status === 'error' ? 'I could not read this account just now.' : null, updatedAt: r.updated_at }
}

/** Claim now (so the card says "reading" at once), read after the response. */
async function startReads(ctx: Ctx, accounts: Array<{ accountId: string; email: string | null }>): Promise<void> {
  const claimed: string[] = []
  for (const a of accounts) {
    if (await claimFirstRead(ctx.tenant.id, a.accountId, ctx.member.id, a.email).catch(() => false)) claimed.push(a.accountId)
  }
  if (!claimed.length) return
  after(async () => {
    for (const accountId of claimed) await runFirstRead({ repId: ctx.tenant.id, accountId, memberId: ctx.member.id, claimed: true })
  })
}

async function readsFor(ctx: Ctx, accountIds: string[]) {
  return (await listFirstReads(ctx.tenant.id, accountIds)).filter((r) => !r.dismissed_at)
}

export async function GET() {
  const g = await gate()
  if ('err' in g) return g.err
  if (!g.accounts.length) return NextResponse.json({ reads: [] })
  const ids = g.accounts.map((a) => a.accountId)
  try {
    const all = await listFirstReads(g.ctx.tenant.id, ids)
    const missing = g.accounts.filter((a) => !all.some((r) => r.account_id === a.accountId))
    if (missing.length) await startReads(g.ctx, missing)
    return NextResponse.json({ reads: (await readsFor(g.ctx, ids)).map(view) })
  } catch (e) {
    // Table not there yet (migration not run): the card stays hidden.
    console.error('[first-read] GET', e instanceof Error ? e.message.slice(0, 200) : e)
    return NextResponse.json({ reads: [] })
  }
}

export async function POST(req: Request) {
  const g = await gate()
  if ('err' in g) return g.err
  const body = (await req.json().catch(() => ({}))) as { accountId?: unknown }
  const want = typeof body.accountId === 'string' ? body.accountId : null
  const accounts = want ? g.accounts.filter((a) => a.accountId === want) : g.accounts
  if (!accounts.length) return NextResponse.json({ error: want ? 'That Google account is not yours.' : 'Connect Google first.' }, { status: want ? 404 : 400 })
  await startReads(g.ctx, accounts)
  return NextResponse.json({ reads: (await readsFor(g.ctx, g.accounts.map((a) => a.accountId))).map(view) })
}

export async function PATCH(req: Request) {
  const g = await gate()
  if ('err' in g) return g.err
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; dismiss?: unknown }
  if (typeof body.id !== 'string' || body.dismiss !== true) return NextResponse.json({ error: 'Say which read to hide.' }, { status: 400 })
  const ok = await dismissFirstRead(g.ctx.tenant.id, g.accounts.map((a) => a.accountId), body.id)
  if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
