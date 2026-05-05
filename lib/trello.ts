// Trello API client — manual token flow (user visits authorize URL, copies token back).
// The API key is server-only: TRELLO_API_KEY.
// User tokens are stored in reps.integrations.trello_token + trello_member_id.

const TRELLO_BASE = 'https://api.trello.com/1'

// ── Types ──────────────────────────────────────────────────────────────────

export type TrelloBoard = {
  id: string
  name: string
  url: string
  closed: boolean
}

export type TrelloCard = {
  id: string
  name: string
  desc: string
  url: string
  due: string | null
  labels: { color: string; name: string }[]
  idList: string
}

export type TrelloList = {
  id: string
  name: string
  cards: TrelloCard[]
}

// ── Config helpers ─────────────────────────────────────────────────────────

export function trelloConfigured(): boolean {
  return Boolean(process.env.TRELLO_API_KEY)
}

export function buildTrelloAuthUrl(): string {
  const key = process.env.TRELLO_API_KEY ?? ''
  return `https://trello.com/1/authorize?expiration=never&name=VirtualCloser&scope=read%2Cwrite&response_type=token&key=${key}`
}

// ── API helpers ────────────────────────────────────────────────────────────

function authParams(token: string): string {
  const key = process.env.TRELLO_API_KEY ?? ''
  return `key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`
}

// ── Public API functions ───────────────────────────────────────────────────

/**
 * Validates a Trello token by calling /members/me.
 * Returns member info on success, null on failure (bad token, revoked, etc).
 */
export async function validateTrelloToken(
  token: string,
): Promise<{ id: string; username: string; fullName: string } | null> {
  try {
    const res = await fetch(
      `${TRELLO_BASE}/members/me?fields=id,username,fullName&${authParams(token)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      id: string
      username: string
      fullName: string
    }
    if (!data?.id) return null
    return { id: data.id, username: data.username, fullName: data.fullName }
  } catch {
    return null
  }
}

/**
 * Returns all open boards for the authenticated user.
 */
export async function getTrelloBoards(token: string): Promise<TrelloBoard[]> {
  const res = await fetch(
    `${TRELLO_BASE}/members/me/boards?filter=open&fields=id,name,url,closed&${authParams(token)}`,
    { cache: 'no-store' },
  )
  if (!res.ok) return []
  const data = (await res.json()) as TrelloBoard[]
  return Array.isArray(data) ? data : []
}

/**
 * Returns all lists for a board, each with their open cards embedded.
 */
export async function getTrelloListsWithCards(
  token: string,
  boardId: string,
): Promise<TrelloList[]> {
  const res = await fetch(
    `${TRELLO_BASE}/boards/${boardId}/lists?cards=open&card_fields=id,name,desc,url,due,labels,idList&${authParams(token)}`,
    { cache: 'no-store' },
  )
  if (!res.ok) return []
  const data = (await res.json()) as Array<{
    id: string
    name: string
    cards?: TrelloCard[]
  }>
  if (!Array.isArray(data)) return []
  return data.map((list) => ({
    id: list.id,
    name: list.name,
    cards: Array.isArray(list.cards) ? list.cards : [],
  }))
}
