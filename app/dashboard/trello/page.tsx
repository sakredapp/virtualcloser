import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isGatewayHost, requireTenant, getCurrentMember } from '@/lib/tenant'
import { buildDashboardTabs } from '../dashboardTabs'
import DashboardNav from '../DashboardNav'
import { getTrelloBoards, getTrelloListsWithCards, type TrelloList } from '@/lib/trello'
import TrelloBoardSelect from './TrelloBoardSelect'

export const dynamic = 'force-dynamic'

// Label color → CSS color mapping (Trello's named colors)
const LABEL_COLORS: Record<string, string> = {
  green: '#61bd4f',
  yellow: '#f2d600',
  orange: '#ff9f1a',
  red: '#eb5a46',
  purple: '#c377e0',
  blue: '#0079bf',
  sky: '#00c2e0',
  lime: '#51e898',
  pink: '#ff78cb',
  black: '#344563',
  green_dark: '#519839',
  yellow_dark: '#d9b51c',
  orange_dark: '#d29034',
  red_dark: '#b04632',
  purple_dark: '#89609e',
  blue_dark: '#055a8c',
}

function formatDue(due: string | null): string | null {
  if (!due) return null
  const d = new Date(due)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const days = Math.ceil(diff / 86_400_000)
  if (days < 0) return `Overdue ${Math.abs(days)}d`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days}d`
}

function dueClass(due: string | null): string {
  if (!due) return ''
  const d = new Date(due)
  const now = new Date()
  if (d < now) return 'overdue'
  const diff = d.getTime() - now.getTime()
  if (diff < 86_400_000) return 'due-soon'
  return ''
}

export default async function TrelloPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>
}) {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  let tenant
  try {
    tenant = await requireTenant()
  } catch {
    redirect('/login')
  }

  const member = await getCurrentMember()
  const navTabs = await buildDashboardTabs(tenant.id, member)
  const params = await searchParams

  const integrations = (tenant.integrations ?? {}) as Record<string, unknown>
  const trelloApiKey = typeof integrations.trello_api_key === 'string' ? integrations.trello_api_key : null
  const trelloToken = typeof integrations.trello_token === 'string' ? integrations.trello_token : null
  const defaultBoardId = typeof integrations.trello_default_board_id === 'string' ? integrations.trello_default_board_id : null

  // Not connected
  if (!trelloApiKey || !trelloToken) {
    return (
      <main className="wrap">
        <header className="hero">
          <div>
            <h1>Trello</h1>
            <p className="sub">Connect Trello to view your boards here.</p>
          </div>
        </header>
        <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
        <section style={{ marginTop: '2rem', maxWidth: 480 }}>
          <p className="meta" style={{ marginBottom: '1rem' }}>
            You haven&apos;t connected Trello yet. Head to Integrations to link your account.
          </p>
          <Link href="/dashboard/integrations" className="btn approve">
            Go to Integrations →
          </Link>
        </section>
      </main>
    )
  }

  // Fetch boards
  const boards = await getTrelloBoards(trelloApiKey, trelloToken).catch(() => [])

  // Auto-select: use ?board= param, then default board setting, then first board
  const selectedBoardId = params.board ?? defaultBoardId ?? boards[0]?.id ?? null

  // Fetch lists + cards for selected board
  let lists: TrelloList[] = []
  if (selectedBoardId) {
    lists = await getTrelloListsWithCards(trelloApiKey, trelloToken, selectedBoardId).catch(() => [])
  }

  const activeBoard = boards.find((b) => b.id === selectedBoardId) ?? null

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Boards</p>
          <h1>{activeBoard ? activeBoard.name : 'Trello'}</h1>
          <p className="sub">Your Trello board — live view, updates every visit.</p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <TrelloBoardSelect boards={boards} selectedBoardId={selectedBoardId} />

      {boards.length === 0 && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <p className="empty">No open boards found in your Trello account.</p>
        </section>
      )}

      {boards.length > 0 && !selectedBoardId && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <p className="empty">Select a board above to view its cards.</p>
        </section>
      )}

      {/* Kanban layout */}
      {selectedBoardId && lists.length > 0 && (
        <>
          <style>{`
            .trello-kanban {
              display: flex;
              gap: 0.6rem;
              overflow-x: auto;
              padding: 0.8rem 0 1.5rem;
              align-items: flex-start;
            }
            .trello-label-dot {
              width: 9px;
              height: 9px;
              border-radius: 50%;
              flex-shrink: 0;
            }
          `}</style>
          <div className="trello-kanban">
            {lists.map((list) => (
              <div key={list.id} className="card" style={{ flex: '0 0 220px', padding: '0.65rem 0.75rem' }}>
                <p className="meta" style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: '0.5rem',
                }}>
                  {list.name}
                  <span style={{ fontWeight: 400, marginLeft: 4, opacity: 0.55 }}>
                    ({list.cards.length})
                  </span>
                </p>

                {list.cards.length === 0 && (
                  <p className="hint" style={{ margin: 0, fontSize: '0.78rem' }}>No cards</p>
                )}

                {list.cards.map((card) => {
                  const dueLabel = formatDue(card.due)
                  const dueCls = dueClass(card.due)
                  return (
                    <div key={card.id} style={{
                      border: '1px solid var(--border-soft)',
                      borderRadius: 8,
                      padding: '0.45rem 0.55rem',
                      marginBottom: '0.35rem',
                      display: 'grid',
                      gap: '0.25rem',
                      background: 'var(--paper)',
                    }}>
                      <a
                        href={card.url}
                        target="_blank"
                        rel="noreferrer"
                        className="name"
                        style={{ fontSize: '0.85rem', fontWeight: 500, textDecoration: 'none', lineHeight: 1.35 }}
                      >
                        {card.name}
                      </a>
                      {(dueLabel || card.labels.length > 0) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {dueLabel && (
                            <span className="status" style={
                              dueCls === 'overdue'
                                ? { background: 'rgba(235,90,70,0.12)', color: 'var(--red)', borderColor: 'transparent' }
                                : dueCls === 'due-soon'
                                ? { background: 'rgba(242,214,0,0.18)', color: '#7a5c00', borderColor: 'transparent' }
                                : { background: 'var(--paper-2)', borderColor: 'transparent' }
                            }>
                              {dueLabel}
                            </span>
                          )}
                          {card.labels.map((label, i) => (
                            <span
                              key={i}
                              className="trello-label-dot"
                              title={label.name || label.color}
                              style={{
                                background:
                                  LABEL_COLORS[label.color] ??
                                  LABEL_COLORS[label.color.replace('_dark', '')] ??
                                  '#888',
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {activeBoard?.url && (
            <div style={{ marginTop: '0.25rem' }}>
              <a href={activeBoard.url} target="_blank" rel="noreferrer" className="btn">
                Open in Trello →
              </a>
            </div>
          )}
        </>
      )}

      {selectedBoardId && lists.length === 0 && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <p className="empty">No lists found in this board.</p>
        </section>
      )}
    </main>
  )
}
