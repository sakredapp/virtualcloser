import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isGatewayHost, requireTenant, getCurrentMember } from '@/lib/tenant'
import { buildDashboardTabs } from '../dashboardTabs'
import DashboardNav from '../DashboardNav'
import { getTrelloBoards, getTrelloListsWithCards, type TrelloList } from '@/lib/trello'

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
  const selectedBoardId = params.board ?? null

  const integrations = (tenant.integrations ?? {}) as Record<string, unknown>
  const trelloToken =
    typeof integrations.trello_token === 'string' ? integrations.trello_token : null

  // Not connected
  if (!trelloToken) {
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
  const boards = await getTrelloBoards(trelloToken).catch(() => [])

  // Fetch lists + cards for selected board
  let lists: TrelloList[] = []
  if (selectedBoardId) {
    lists = await getTrelloListsWithCards(trelloToken, selectedBoardId).catch(() => [])
  }

  const activeBoard = boards.find((b) => b.id === selectedBoardId) ?? null

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <h1>Trello{activeBoard ? ` — ${activeBoard.name}` : ''}</h1>
          <p className="sub">View and navigate your Trello boards.</p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {/* Board selector */}
      {boards.length > 0 && (
        <div
          style={{
            marginTop: '1.2rem',
            overflowX: 'auto',
            paddingBottom: '0.3rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '0.4rem',
              flexWrap: 'nowrap',
              minWidth: 'max-content',
            }}
          >
            {boards.map((board) => {
              const isActive = board.id === selectedBoardId
              return (
                <Link
                  key={board.id}
                  href={`/dashboard/trello?board=${board.id}`}
                  style={{
                    padding: '0.35rem 0.85rem',
                    borderRadius: 20,
                    fontSize: '0.85rem',
                    fontWeight: isActive ? 700 : 500,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    background: isActive ? 'var(--royal)' : 'var(--paper)',
                    color: isActive ? '#fff' : 'var(--ink)',
                    border: isActive ? '1.5px solid var(--royal)' : '1.5px solid rgba(15,15,15,0.15)',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {board.name}
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {boards.length === 0 && (
        <p className="meta" style={{ marginTop: '1.5rem' }}>
          No open boards found in your Trello account.
        </p>
      )}

      {/* No board selected */}
      {boards.length > 0 && !selectedBoardId && (
        <p className="meta" style={{ marginTop: '1.5rem' }}>
          Select a board above to view its cards.
        </p>
      )}

      {/* Kanban layout */}
      {selectedBoardId && lists.length > 0 && (
        <>
          <style>{`
            .trello-kanban {
              display: flex;
              gap: 0.75rem;
              overflow-x: auto;
              padding: 1rem 0 1.5rem;
              align-items: flex-start;
            }
            .trello-list-col {
              flex: 0 0 220px;
              background: var(--paper);
              border: 1px solid rgba(15,15,15,0.13);
              border-radius: 10px;
              padding: 0.6rem;
            }
            .trello-list-title {
              font-weight: 700;
              font-size: 0.82rem;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: var(--muted);
              margin-bottom: 0.5rem;
              padding: 0 0.1rem;
            }
            .trello-card {
              background: var(--paper);
              border: 1px solid rgba(15,15,15,0.1);
              border-radius: 7px;
              padding: 0.45rem 0.55rem;
              margin-bottom: 0.35rem;
              display: grid;
              gap: 0.25rem;
            }
            .trello-card:last-child { margin-bottom: 0; }
            .trello-card-name {
              font-size: 0.85rem;
              font-weight: 500;
              color: var(--ink);
              line-height: 1.35;
              text-decoration: none;
            }
            .trello-card-name:hover { color: var(--royal); }
            .trello-card-meta {
              display: flex;
              align-items: center;
              gap: 0.4rem;
              flex-wrap: wrap;
            }
            .trello-due {
              font-size: 0.72rem;
              font-weight: 600;
              padding: 0.1rem 0.45rem;
              border-radius: 10px;
              background: rgba(15,15,15,0.07);
              color: var(--muted);
            }
            .trello-due.overdue {
              background: rgba(235,90,70,0.12);
              color: var(--red);
            }
            .trello-due.due-soon {
              background: rgba(242,214,0,0.18);
              color: #a07c00;
            }
            .trello-label-dot {
              width: 10px;
              height: 10px;
              border-radius: 50%;
              flex-shrink: 0;
            }
          `}</style>
          <div className="trello-kanban">
            {lists.map((list) => (
              <div key={list.id} className="trello-list-col">
                <div className="trello-list-title">
                  {list.name}
                  <span style={{ fontWeight: 400, marginLeft: 4, color: 'var(--muted)', opacity: 0.6 }}>
                    ({list.cards.length})
                  </span>
                </div>
                {list.cards.length === 0 && (
                  <p style={{ fontSize: '0.78rem', color: 'var(--muted)', padding: '0.2rem 0.1rem', margin: 0 }}>
                    No cards
                  </p>
                )}
                {list.cards.map((card) => {
                  const dueLabel = formatDue(card.due)
                  const dueCls = dueClass(card.due)
                  return (
                    <div key={card.id} className="trello-card">
                      <a
                        href={card.url}
                        target="_blank"
                        rel="noreferrer"
                        className="trello-card-name"
                      >
                        {card.name}
                      </a>
                      {(dueLabel || card.labels.length > 0) && (
                        <div className="trello-card-meta">
                          {dueLabel && (
                            <span className={`trello-due ${dueCls}`}>{dueLabel}</span>
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
          <p className="meta" style={{ marginTop: 0 }}>
            <a
              href={activeBoard?.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--royal)', fontWeight: 600 }}
            >
              Open in Trello →
            </a>
          </p>
        </>
      )}

      {selectedBoardId && lists.length === 0 && (
        <p className="meta" style={{ marginTop: '1.5rem' }}>
          No lists found in this board.
        </p>
      )}
    </main>
  )
}
