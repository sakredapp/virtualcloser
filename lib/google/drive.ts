// Google Drive helpers — folder lookup/create + Doc creation from markdown.
//
// Reuses the per-rep / per-member OAuth tokens managed by lib/google.ts. The
// Plaud agent calls findOrCreateDriveFolder() to look up/seed the per-rep
// folders, then createGoogleDocFromMarkdown() to drop generated deliverables
// into them.
//
// Strategy for "markdown → Google Doc":
//   1. files.create (multipart upload) with mimeType:'text/markdown' and
//      destination mimeType:'application/vnd.google-apps.document' so Drive
//      auto-converts on upload. Single round-trip, no batchUpdate dance.
//
// All helpers prefer the per-member token when memberId is given; fall back
// to the tenant-level connection. Returns null on auth failure (caller
// decides whether to warn).

import { getGoogleAccessToken } from '@/lib/google'

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DOC_MIME = 'application/vnd.google-apps.document'

export type DriveTarget = { memberId?: string | null }

export type DriveFolder = { id: string; name: string; webViewLink: string }
export type DriveFile = { id: string; name: string; webViewLink: string; mimeType: string }

// Discriminated result type so callers (the Plaud agent executor) can
// surface accurate errors. "scope_missing" specifically means the rep's
// Google token doesn't include drive.file — the integrations page already
// has a reconnect banner for this state.
export type DriveError =
  | 'not_connected'      // no Google token at all
  | 'scope_missing'      // token exists but drive.file scope not granted
  | 'unauthorized'       // 401 — token expired or revoked
  | 'rate_limited'       // 429
  | 'unknown'            // other non-2xx

export type DriveResult<T> = { ok: true; value: T } | { ok: false; error: DriveError; status?: number }

function classifyDriveError(status: number, body: string): DriveError {
  if (status === 401) return 'unauthorized'
  if (status === 429) return 'rate_limited'
  if (status === 403) {
    // Drive returns insufficientPermissions when the scope isn't granted.
    if (body.includes('insufficientPermissions') || body.includes('insufficient_scope')) {
      return 'scope_missing'
    }
    return 'unauthorized'
  }
  return 'unknown'
}

function escapeQuery(value: string): string {
  // Drive query syntax: backslash-escape backslash and single quote.
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function driveGet<T = unknown>(
  repId: string,
  memberId: string | null,
  path: string,
  params: Record<string, string> = {},
): Promise<T | null> {
  const token = await getGoogleAccessToken(repId, memberId)
  if (!token) return null
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${DRIVE_FILES}${path}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error('[drive] GET failed', path, res.status, await res.text())
    return null
  }
  return (await res.json()) as T
}

/**
 * Find a folder by name (optionally inside a parent), or create it if missing.
 * Folders are scoped to the connected Google account and reachable via
 * drive.file (Drive treats folders the app created as "files the app owns").
 */
export async function findOrCreateDriveFolder(
  repId: string,
  name: string,
  opts: DriveTarget & { parentId?: string | null } = {},
): Promise<DriveFolder | null> {
  const memberId = opts.memberId ?? null
  const parentClause = opts.parentId
    ? ` and '${escapeQuery(opts.parentId)}' in parents`
    : ''
  const list = await driveGet<{ files?: Array<{ id: string; name: string; webViewLink: string }> }>(
    repId,
    memberId,
    '',
    {
      q: `mimeType = '${FOLDER_MIME}' and name = '${escapeQuery(name)}' and trashed = false${parentClause}`,
      fields: 'files(id, name, webViewLink)',
      pageSize: '1',
    },
  )
  if (!list) return null
  const found = list.files?.[0]
  if (found) return { id: found.id, name: found.name, webViewLink: found.webViewLink }

  // Create it.
  const token = await getGoogleAccessToken(repId, memberId)
  if (!token) return null
  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME }
  if (opts.parentId) body.parents = [opts.parentId]
  const res = await fetch(`${DRIVE_FILES}?fields=id,name,webViewLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error('[drive] folder create failed', res.status, await res.text())
    return null
  }
  const json = (await res.json()) as { id: string; name: string; webViewLink: string }
  return { id: json.id, name: json.name, webViewLink: json.webViewLink }
}

/**
 * Upload markdown as a Google Doc (Drive auto-converts on the way in).
 * Returns the created file's id + webViewLink for storing in plaud_actions.result.
 *
 * Note: Drive's multipart upload uses a specific boundary format. We build it
 * by hand here rather than pulling in a multipart library — the request is
 * structured and stable, and node 24's fetch handles it cleanly.
 */
export async function createGoogleDocFromMarkdown(
  repId: string,
  input: {
    title: string
    markdown: string
    folderId?: string | null
    memberId?: string | null
  },
): Promise<DriveResult<DriveFile>> {
  const memberId = input.memberId ?? null
  const token = await getGoogleAccessToken(repId, memberId)
  if (!token) return { ok: false, error: 'not_connected' }

  const metadata: Record<string, unknown> = {
    name: input.title,
    mimeType: DOC_MIME, // tell Drive to convert the uploaded text/markdown into a Doc
  }
  if (input.folderId) metadata.parents = [input.folderId]

  const boundary = `plaud-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const closing = `\r\n--${boundary}--`
  const head =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: text/markdown; charset=UTF-8\r\n\r\n'

  const body = Buffer.concat([
    Buffer.from(head, 'utf8'),
    Buffer.from(input.markdown, 'utf8'),
    Buffer.from(closing, 'utf8'),
  ])

  const res = await fetch(
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink,mimeType`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    },
  )
  if (!res.ok) {
    const text = await res.text()
    const err = classifyDriveError(res.status, text)
    console.error('[drive] doc create failed', res.status, err, text.slice(0, 200))
    return { ok: false, error: err, status: res.status }
  }
  const json = (await res.json()) as DriveFile
  return { ok: true, value: json }
}
