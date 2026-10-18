/**
 * "Put this in a Google Sheet" — Ciao's create_sheet_report tool
 * (lib/agent/cxoTools.ts). Creates a NEW spreadsheet in the person's own
 * Google Drive with one Sheets API call (spreadsheets.create, rows included,
 * header bold and frozen), then files it in a Drive folder named after the
 * assistant ("Ciao"). The spreadsheet and the folder are created by the app,
 * so drive.file covers every later access; the folder step is best effort
 * and never fails the report.
 *
 * Takes an access token already chosen by the caller (the person's own
 * connection, pinned by account id), so the folder lands in the same Drive
 * as the sheet.
 */

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export const SHEET_MAX_ROWS = 500
export const SHEET_MAX_COLS = 20
const CELL_MAX = 5000

export type SheetCell = string | number
export type CleanRows = { rows: SheetCell[][]; truncatedRows: boolean; truncatedCols: boolean }

/** A plain number written as text ("1200", "-3.5") becomes a number; "02134" and "1,200" stay text. */
function cell(v: unknown): SheetCell {
  if (typeof v === 'number') return Number.isFinite(v) ? v : ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (v == null) return ''
  const s = String(v).slice(0, CELL_MAX)
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s.trim())) return Number(s.trim())
  return s
}

/**
 * The header row plus up to SHEET_MAX_ROWS data rows, each at most
 * SHEET_MAX_COLS wide. Null when there is no usable header row.
 */
export function cleanRows(raw: unknown): CleanRows | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const asRow = (r: unknown): unknown[] => (Array.isArray(r) ? r : r && typeof r === 'object' ? Object.values(r as Record<string, unknown>) : [r])
  const all = raw.map(asRow)
  const header = all[0]
  if (!header.length || header.every((h) => h == null || String(h).trim() === '')) return null
  const truncatedRows = all.length - 1 > SHEET_MAX_ROWS
  const truncatedCols = all.some((r) => r.length > SHEET_MAX_COLS)
  const rows = all.slice(0, SHEET_MAX_ROWS + 1).map((r, i) => r.slice(0, SHEET_MAX_COLS).map((v) => (i === 0 ? String(v ?? '').slice(0, CELL_MAX) : cell(v))))
  return { rows, truncatedRows, truncatedCols }
}

/** The spreadsheets.create body: title, one tab, header bold + frozen, every row as typed values. */
export function spreadsheetCreateBody(title: string, rows: SheetCell[][]): Record<string, unknown> {
  return {
    properties: { title },
    sheets: [
      {
        properties: { title: 'Report', gridProperties: { frozenRowCount: 1 } },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: rows.map((r, i) => ({
              values: r.map((v) => ({
                userEnteredValue: typeof v === 'number' ? { numberValue: v } : { stringValue: v },
                ...(i === 0 ? { userEnteredFormat: { textFormat: { bold: true } } } : {}),
              })),
            })),
          },
        ],
      },
    ],
  }
}

export type SheetCreateError = 'scope_missing' | 'unauthorized' | 'google_error'
export type SheetCreateResult =
  | { ok: true; spreadsheetId: string; url: string; folder: { id: string; name: string; url: string | null } | null }
  | { ok: false; error: SheetCreateError; status?: number }

function scopeDenied(status: number, text: string): boolean {
  return status === 403 && /insufficient|PERMISSION_DENIED|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(text)
}

function escapeQuery(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Find (or make) the app's own folder, then move the file into it. Null on any failure. */
async function fileInFolder(token: string, fileId: string, folderName: string): Promise<{ id: string; name: string; url: string | null } | null> {
  const auth = { Authorization: `Bearer ${token}` }
  try {
    const q = `mimeType = '${FOLDER_MIME}' and name = '${escapeQuery(folderName)}' and trashed = false`
    const found = await fetch(`${DRIVE_FILES}?${new URLSearchParams({ q, fields: 'files(id,name,webViewLink)', pageSize: '1', spaces: 'drive' })}`, { headers: auth })
    if (!found.ok) return null
    let folder = ((await found.json()) as { files?: Array<{ id: string; name: string; webViewLink?: string }> }).files?.[0] ?? null
    if (!folder) {
      const made = await fetch(`${DRIVE_FILES}?fields=id,name,webViewLink`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME }),
      })
      if (!made.ok) return null
      folder = (await made.json()) as { id: string; name: string; webViewLink?: string }
    }
    const meta = await fetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}?fields=parents`, { headers: auth })
    const parents = meta.ok ? (((await meta.json()) as { parents?: string[] }).parents ?? []) : []
    const params = new URLSearchParams({ addParents: folder.id, fields: 'id,parents' })
    const remove = parents.filter((p) => p !== folder!.id)
    if (remove.length) params.set('removeParents', remove.join(','))
    const moved = await fetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}?${params}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!moved.ok) return null
    return { id: folder.id, name: folder.name, url: folder.webViewLink ?? null }
  } catch {
    return null
  }
}

/** Create the spreadsheet with its rows, then (best effort) file it in the assistant's folder. */
export async function createSpreadsheetReport(
  token: string,
  input: { title: string; rows: SheetCell[][]; folderName?: string | null },
): Promise<SheetCreateResult> {
  const res = await fetch(SHEETS_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(spreadsheetCreateBody(input.title, input.rows)),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (scopeDenied(res.status, text)) return { ok: false, error: 'scope_missing', status: res.status }
    if (res.status === 401) return { ok: false, error: 'unauthorized', status: res.status }
    console.error('[cxoSheets] create failed', res.status, text.slice(0, 300))
    return { ok: false, error: 'google_error', status: res.status }
  }
  const json = (await res.json()) as { spreadsheetId: string; spreadsheetUrl?: string }
  const url = json.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${json.spreadsheetId}/edit`
  const folder = input.folderName ? await fileInFolder(token, json.spreadsheetId, input.folderName) : null
  return { ok: true, spreadsheetId: json.spreadsheetId, url, folder }
}
