import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import DashboardNav from '../../DashboardNav'
import { buildDashboardTabs } from '../../dashboardTabs'
import { isAtLeast } from '@/lib/permissions'
import { listMembers } from '@/lib/members'
import {
  canAccessRoom,
  createRoomMessage,
  createRoomTodo,
  describeAudience,
  listAudience,
  listRoomMessages,
  listRoomTodos,
  relayRoomMessage,
  setRoomTodoStatus,
  type RoomAudience,
} from '@/lib/rooms'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ scope: string }>
  searchParams?: Promise<{ status?: string }>
}

export default async function RoomPage({ params, searchParams }: Props) {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  const { scope } = await params
  const sp = (await searchParams) ?? {}

  // Only role-rooms ('managers' / 'owners') are routed here. Team rooms get
  // their own URL elsewhere when we wire that up.
  if (scope !== 'managers' && scope !== 'owners') notFound()
  const audience: RoomAudience = scope

  const { tenant, member } = await requireMember()
  if (!canAccessRoom(member.role, audience)) {
    redirect('/dashboard?status=no-room-access')
  }
  const navTabs = await buildDashboardTabs(tenant.id, member)

  const [messages, todos, audienceMembers, allMembers] = await Promise.all([
    listRoomMessages(tenant.id, audience, 200),
    listRoomTodos(tenant.id, audience, false),
    listAudience(tenant.id, audience),
    listMembers(tenant.id),
  ])
  const memberById = new Map(allMembers.map((m) => [m.id, m]))
  const isAdmin = isAtLeast(member.role, 'admin')
  const label = describeAudience(audience)

  // Group messages by thread root: top-level posts on top, replies underneath.
  const roots = messages.filter((m) => !m.parent_message_id).reverse() // chronological
  const repliesByParent = new Map<string, typeof messages>()
  for (const m of messages) {
    if (m.parent_message_id) {
      const list = repliesByParent.get(m.parent_message_id) ?? []
      list.push(m)
      repliesByParent.set(m.parent_message_id, list)
    }
  }
  for (const list of repliesByParent.values()) list.reverse()

  // ── Server actions ────────────────────────────────────────────────────
  async function onPostMessage(formData: FormData) {
    'use server'
    const { tenant, member } = await requireMember()
    if (!canAccessRoom(member.role, audience)) redirect('/dashboard')
    const body = String(formData.get('body') ?? '').trim()
    if (!body) redirect(`/dashboard/room/${scope}?status=empty`)
    const post = await createRoomMessage({
      repId: tenant.id,
      audience,
      senderMemberId: member.id,
      body,
      kind: 'text',
    })
    await relayRoomMessage(post, member.display_name || member.email)
    revalidatePath(`/dashboard/room/${scope}`)
    redirect(`/dashboard/room/${scope}?status=posted`)
  }

  async function onAddTodo(formData: FormData) {
    'use server'
    const { tenant, member } = await requireMember()
    if (!canAccessRoom(member.role, audience)) redirect('/dashboard')
    const body = String(formData.get('body') ?? '').trim()
    if (!body) redirect(`/dashboard/room/${scope}?status=empty`)
    const assignedToRaw = String(formData.get('assigned_to') ?? '')
    const assignedTo = assignedToRaw && assignedToRaw !== '__none__' ? assignedToRaw : null
    await createRoomTodo({
      repId: tenant.id,
      audience,
      createdBy: member.id,
      body,
      assignedTo,
    })
    revalidatePath(`/dashboard/room/${scope}`)
    redirect(`/dashboard/room/${scope}?status=todo-added`)
  }

  async function onCompleteTodo(formData: FormData) {
    'use server'
    const { tenant, member } = await requireMember()
    if (!canAccessRoom(member.role, audience)) redirect('/dashboard')
    const id = String(formData.get('id') ?? '')
    if (!id) return
    await setRoomTodoStatus(id, tenant.id, 'done')
    revalidatePath(`/dashboard/room/${scope}`)
  }

  const banner =
    sp.status === 'posted' ? `Posted — relayed 1:1 to everyone in ${label}.` :
    sp.status === 'todo-added' ? 'Todo added.' :
    sp.status === 'empty' ? 'Type something first.' :
    null

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">{tenant.display_name}</p>
          <h1>{label}</h1>
          <p className="sub">
            Private to {audience === 'owners' ? 'admins + owners' : 'managers, admins, and owners'}.
            Posts here are relayed 1:1 over Telegram to every member of this room — nobody is reading a group chat.
          </p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {banner && (
        <p className="card" style={{ marginTop: '0.8rem', padding: '0.7rem 1rem' }}>{banner}</p>
      )}

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.4rem' }}>People in this room</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
          {audienceMembers.length === 0
            ? 'No one yet.'
            : audienceMembers.map((m) => m.display_name).join(' · ')}
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <h2 style={{ marginTop: 0 }}>Post to the room</h2>
        <form action={onPostMessage} style={{ display: 'grid', gap: '0.6rem' }}>
          <textarea
            name="body"
            rows={3}
            required
            placeholder={`What do you want ${label} to know?`}
            style={inp}
          />
          <div>
            <button type="submit" className="btn btn-primary">Send (relays 1:1 to everyone)</button>
          </div>
        </form>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.6rem' }}>
          Tip: you can also just say it in Telegram — _&ldquo;tell the {audience} we shifted the demo&rdquo;_ — and the assistant will confirm before sending.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <h2 style={{ marginTop: 0 }}>Shared todos</h2>
        <form action={onAddTodo} style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.8rem' }}>
          <input name="body" required placeholder="What needs to happen?" style={inp} />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ ...lbl, margin: 0 }}>
              Assign
              <select name="assigned_to" defaultValue="__none__" style={{ ...inp, padding: '0.4rem 0.6rem' }}>
                <option value="__none__">— anyone —</option>
                {audienceMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn">Add todo</button>
          </div>
        </form>
        {todos.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>No open todos. Quiet around here.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
            {todos.map((t) => (
              <li
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.5rem 0.7rem',
                  border: '1px solid var(--panel-border, #e8e2d4)',
                  borderRadius: 6,
                  gap: '0.6rem',
                }}
              >
                <div>
                  <strong>{t.body}</strong>
                  {t.assigned_to && (
                    <span style={{ marginLeft: '0.6rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                      → {memberById.get(t.assigned_to)?.display_name ?? '—'}
                    </span>
                  )}
                </div>
                <form action={onCompleteTodo}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className="btn" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}>
                    Done
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <h2 style={{ marginTop: 0 }}>Recent activity</h2>
        {roots.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            No posts yet. Drop the first one above or speak it to your assistant.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.8rem' }}>
            {roots.map((m) => {
              const sender = m.sender_member_id ? memberById.get(m.sender_member_id) : null
              const replies = repliesByParent.get(m.id) ?? []
              return (
                <li
                  key={m.id}
                  style={{
                    border: '1px solid var(--panel-border, #e8e2d4)',
                    borderRadius: 6,
                    padding: '0.7rem 0.9rem',
                    background: 'var(--panel-2, #f7f4ef)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <strong>{sender?.display_name ?? 'Unknown'}</strong>
                    <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                      {new Date(m.created_at).toLocaleString()} · delivered to {m.delivered_count}
                    </span>
                  </div>
                  <p style={{ margin: '0.3rem 0 0', whiteSpace: 'pre-wrap' }}>
                    {m.body || m.transcript || (m.kind === 'voice' ? '🎙 voice note' : '—')}
                  </p>
                  {replies.length > 0 && (
                    <ul style={{ listStyle: 'none', padding: '0.6rem 0 0 0.8rem', margin: 0, borderLeft: '2px solid var(--ink)', display: 'grid', gap: '0.4rem' }}>
                      {replies.map((r) => {
                        const rs = r.sender_member_id ? memberById.get(r.sender_member_id) : null
                        return (
                          <li key={r.id} style={{ paddingLeft: '0.6rem' }}>
                            <span style={{ fontWeight: 600 }}>{rs?.display_name ?? 'Unknown'}</span>
                            <span style={{ color: 'var(--muted)', fontSize: '0.78rem', marginLeft: '0.5rem' }}>
                              {new Date(r.created_at).toLocaleString()}
                            </span>
                            <div style={{ whiteSpace: 'pre-wrap' }}>
                              {r.body || r.transcript || (r.kind === 'voice' ? '🎙 voice reply' : '—')}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}

const lbl: React.CSSProperties = {
  display: 'grid',
  gap: '0.25rem',
  fontSize: '0.85rem',
  color: 'var(--muted)',
}

const inp: React.CSSProperties = {
  padding: '0.55rem 0.7rem',
  border: '1px solid var(--panel-border, #d6cfbd)',
  borderRadius: 4,
  background: 'var(--panel)',
  color: 'var(--ink)',
  fontSize: '0.95rem',
}
