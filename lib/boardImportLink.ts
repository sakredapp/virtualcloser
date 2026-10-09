/**
 * "Import a board" → Paste a link. Server side only.
 *
 * Not an open fetcher: only Trello boards and Google Sheets, https only, a
 * fixed host list checked on every hop (redirects are followed by hand and
 * must stay on the list), 10s timeout, 5MB cap.
 */
import type { ImportPayload } from '@/lib/boardsShared'
import { fromTrelloObject, parseCsv } from '@/lib/boardImport'

export const PRIVATE_TRELLO =
  'This board is private. In Trello: Menu → Print, export and share → Export as JSON, then use Upload a file.'

const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000

/** Hosts a request (or a redirect) may go to. Sheets downloads hop to googleusercontent. */
export function allowedHost(host: string): boolean {
  const h = host.toLowerCase()
  return (
    h === 'trello.com' ||
    h === 'www.trello.com' ||
    h === 'api.trello.com' ||
    h === 'docs.google.com' ||
    /^[a-z0-9-]+\.googleusercontent\.com$/.test(h)
  )
}

export type LinkKind =
  | { kind: 'trello'; id: string }
  | { kind: 'trello-card' }
  | { kind: 'sheet'; fetchUrl: string }
  | { kind: 'other-tool'; tool: string }
  | { kind: 'unknown' }

const OTHER_TOOLS: Array<[RegExp, string]> = [
  [/(^|\.)asana\.com$/, 'Asana'],
  [/(^|\.)monday\.com$/, 'Monday'],
  [/(^|\.)notion\.(so|site)$/, 'Notion'],
  [/(^|\.)airtable\.com$/, 'Airtable'],
  [/(^|\.)clickup\.com$/, 'ClickUp'],
  [/(^|\.)atlassian\.net$/, 'Jira'],
  [/(^|\.)smartsheet\.com$/, 'Smartsheet'],
  [/(^|\.)basecamp\.com$/, 'Basecamp'],
  [/(^|\.)linear\.app$/, 'Linear'],
  [/(^|\.)wrike\.com$/, 'Wrike'],
  [/(^|\.)(sharepoint|office|live)\.com$/, 'Excel'],
]

/** What a pasted link points at. Pure; no network. */
export function classifyLink(input: string): LinkKind {
  let u: URL
  try {
    u = new URL(input.trim().replace(/^(?!https?:\/\/)/i, 'https://'))
  } catch {
    return { kind: 'unknown' }
  }
  const host = u.hostname.toLowerCase()
  if (host === 'trello.com' || host === 'www.trello.com') {
    const b = u.pathname.match(/^\/b\/([A-Za-z0-9]{6,32})(?:[/.]|$)/)
    if (b) return { kind: 'trello', id: b[1] }
    if (/^\/c\//.test(u.pathname)) return { kind: 'trello-card' }
    return { kind: 'unknown' }
  }
  if (host === 'docs.google.com') {
    const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)\//)
    if (pub) {
      const gid = u.searchParams.get('gid')
      return { kind: 'sheet', fetchUrl: `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv${gid ? `&gid=${encodeURIComponent(gid)}` : ''}` }
    }
    const d = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)
    if (d) {
      const gid = u.searchParams.get('gid') ?? u.hash.match(/gid=(\d+)/)?.[1] ?? null
      return { kind: 'sheet', fetchUrl: `https://docs.google.com/spreadsheets/d/${d[1]}/export?format=csv${gid ? `&gid=${encodeURIComponent(gid)}` : ''}` }
    }
    return { kind: 'unknown' }
  }
  for (const [re, tool] of OTHER_TOOLS) if (re.test(host)) return { kind: 'other-tool', tool }
  return { kind: 'unknown' }
}

class LinkError extends Error {}

/** GET with the guards: allowlisted hosts on every hop, timeout, size cap. */
async function guardedGet(url: string): Promise<{ status: number; text: string; contentType: string }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let next = url
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(next)
    if (u.protocol !== 'https:' || !allowedHost(u.hostname)) throw new LinkError('That link goes somewhere we do not import from.')
    let res: Response
    try {
      res = await fetch(u, { redirect: 'manual', signal, headers: { accept: 'application/json,text/csv,*/*' }, cache: 'no-store' })
    } catch (err) {
      if ((err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError') throw new LinkError('That link took too long to answer. Try again, or export the board and upload the file.')
      throw new LinkError('We could not reach that link.')
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new LinkError('That link did not lead to a board.')
      next = new URL(loc, u).toString()
      continue
    }
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > MAX_BYTES) throw new LinkError('That board is too big to import from a link (over 5 MB). Export it and upload the file.')
    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => {})
          throw new LinkError('That board is too big to import from a link (over 5 MB). Export it and upload the file.')
        }
        chunks.push(value)
      }
    }
    const buf = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      buf.set(c, off)
      off += c.byteLength
    }
    return { status: res.status, text: new TextDecoder().decode(buf), contentType: res.headers.get('content-type') ?? '' }
  }
  throw new LinkError('That link redirected too many times.')
}

const TRELLO_FIELDS =
  'fields=name&lists=open&list_fields=name,pos,closed&cards=open&card_fields=name,desc,due,dueComplete,idList,pos,closed,labels&checklists=all&checklist_fields=idCard,pos,checkItems&labels=all'

/** Read a pasted link into a board payload, or throw a plain one-line reason. */
export async function payloadFromLink(input: string): Promise<{ payload: ImportPayload; source: string }> {
  const link = classifyLink(input)
  if (link.kind === 'trello-card') throw new LinkError('That is a link to one Trello card. Paste the board link (it has /b/ in it).')
  if (link.kind === 'other-tool') throw new LinkError(`${link.tool} boards can't be read from a link. In ${link.tool}, export the board to CSV, then use Upload a file.`)
  if (link.kind === 'unknown') throw new LinkError('Paste a Trello board link (trello.com/b/…) or a Google Sheets link.')

  if (link.kind === 'trello') {
    // The board API answers fast with only the fields we need; the .json view is the fallback.
    let r = await guardedGet(`https://trello.com/1/boards/${link.id}?${TRELLO_FIELDS}`)
    if (r.status === 401 || r.status === 403 || r.status === 404) throw new LinkError(PRIVATE_TRELLO)
    if (r.status !== 200) r = await guardedGet(`https://trello.com/b/${link.id}.json`)
    if (r.status === 401 || r.status === 403 || r.status === 404) throw new LinkError(PRIVATE_TRELLO)
    if (r.status !== 200) throw new LinkError('Trello did not send the board. Try again in a minute, or export it and upload the file.')
    let j: unknown
    try {
      j = JSON.parse(r.text)
    } catch {
      throw new LinkError(PRIVATE_TRELLO)
    }
    const payload = fromTrelloObject(j as Parameters<typeof fromTrelloObject>[0], 'Trello board')
    return { payload: { ...payload, source: 'trello-link' }, source: 'trello-link' }
  }

  const r = await guardedGet(link.fetchUrl)
  if (r.status !== 200 || /text\/html/i.test(r.contentType) || /^\s*<(!doctype|html)/i.test(r.text)) {
    throw new LinkError('That sheet is not shared. In Google Sheets: Share → Anyone with the link can view (or File → Share → Publish to web as CSV), then paste the link again.')
  }
  const payload = parseCsv(r.text, 'Google Sheet')
  return { payload: { ...payload, source: 'sheet-link' }, source: 'sheet-link' }
}

export function isLinkError(err: unknown): err is Error {
  return err instanceof LinkError
}
