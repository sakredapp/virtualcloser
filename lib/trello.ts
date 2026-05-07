// Trello API client — per-client credentials (no global env var).
// Each tenant provides their own API key + token, both stored in
// reps.integrations: { trello_api_key, trello_token, trello_member }
//
// API key:   https://trello.com/app-key  (client gets it from their account)
// Token URL: built from their API key below

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

// ── Auth URL ───────────────────────────────────────────────────────────────

/** Build the Trello authorize URL for a specific API key. */
export function buildTrelloAuthUrl(apiKey: string): string {
  return `https://trello.com/1/authorize?expiration=never&name=VirtualCloser&scope=read%2Cwrite&response_type=token&key=${encodeURIComponent(apiKey)}`
}

// ── API helpers ────────────────────────────────────────────────────────────

function authParams(apiKey: string, token: string): string {
  return `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`
}

// ── Public API functions ───────────────────────────────────────────────────

/**
 * Validates a Trello API key + token pair by calling /members/me.
 * Returns member info on success, null on failure.
 */
export async function validateTrelloToken(
  apiKey: string,
  token: string,
): Promise<{ id: string; username: string; fullName: string } | null> {
  try {
    const res = await fetch(
      `${TRELLO_BASE}/members/me?fields=id,username,fullName&${authParams(apiKey, token)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { id: string; username: string; fullName: string }
    if (!data?.id) return null
    return { id: data.id, username: data.username, fullName: data.fullName }
  } catch {
    return null
  }
}

/** Returns all open boards for the authenticated user. */
export async function getTrelloBoards(apiKey: string, token: string): Promise<TrelloBoard[]> {
  const res = await fetch(
    `${TRELLO_BASE}/members/me/boards?filter=open&fields=id,name,url,closed&${authParams(apiKey, token)}`,
    { cache: 'no-store' },
  )
  if (!res.ok) return []
  const data = (await res.json()) as TrelloBoard[]
  return Array.isArray(data) ? data : []
}

/** Creates a card on a Trello list. Returns the new card or null on failure. */
export async function createTrelloCard(
  apiKey: string,
  token: string,
  params: {
    listId: string
    name: string
    desc?: string
    due?: string | null
  },
): Promise<TrelloCard | null> {
  const body = new URLSearchParams({ idList: params.listId, name: params.name })
  if (params.desc) body.set('desc', params.desc)
  if (params.due) body.set('due', params.due)
  const res = await fetch(`${TRELLO_BASE}/cards?${authParams(apiKey, token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  })
  if (!res.ok) return null
  return (await res.json()) as TrelloCard
}

/** Returns all lists for a board, each with their open cards embedded. */
export async function getTrelloListsWithCards(
  apiKey: string,
  token: string,
  boardId: string,
): Promise<TrelloList[]> {
  const res = await fetch(
    `${TRELLO_BASE}/boards/${boardId}/lists?cards=open&card_fields=id,name,desc,url,due,labels,idList&${authParams(apiKey, token)}`,
    { cache: 'no-store' },
  )
  if (!res.ok) return []
  const data = (await res.json()) as Array<{ id: string; name: string; cards?: TrelloCard[] }>
  if (!Array.isArray(data)) return []
  return data.map((list) => ({
    id: list.id,
    name: list.name,
    cards: Array.isArray(list.cards) ? list.cards : [],
  }))
}
