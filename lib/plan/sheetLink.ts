/**
 * A pasted Google Sheets link → the sheet as CSV. Server side only.
 *
 * Not an open fetcher: Google Sheets only, https, a fixed host list checked on
 * every redirect, 10s timeout, 5MB cap. A private sheet (Google bounces to its
 * sign-in page, or answers 401/403/404, or sends an HTML page instead of CSV)
 * gets the one message the executive can act on.
 */
import { allowedHost, classifyLink } from '@/lib/boardImportLink'

export const PRIVATE_SHEET = "Share the sheet as 'anyone with the link can view', or download it as XLSX."
export const NOT_A_SHEET = 'Paste a Google Sheets link (docs.google.com/spreadsheets/…), or upload the file.'

const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000

export class SheetLinkError extends Error {}

/** The CSV export URL for a Google Sheets link, or null when it is not one. Pure. */
export function sheetCsvUrl(link: string): string | null {
  const k = classifyLink(link)
  return k.kind === 'sheet' ? k.fetchUrl : null
}

/** Fetch a Google Sheet as CSV text. Throws SheetLinkError with a message for the page. */
export async function fetchSheetCsv(link: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let url = sheetCsvUrl(link)
  if (!url) throw new SheetLinkError(NOT_A_SHEET)
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url)
    if (u.protocol !== 'https:') throw new SheetLinkError(PRIVATE_SHEET)
    if (/(^|\.)accounts\.google\.com$/i.test(u.hostname)) throw new SheetLinkError(PRIVATE_SHEET)
    if (!allowedHost(u.hostname)) throw new SheetLinkError(PRIVATE_SHEET)
    let res: Response
    try {
      res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1' } })
    } catch {
      throw new SheetLinkError("Couldn't reach Google Sheets. Try again, or download the sheet as XLSX and upload that.")
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new SheetLinkError(PRIVATE_SHEET)
      url = new URL(loc, url).toString()
      continue
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new SheetLinkError(PRIVATE_SHEET)
    if (!res.ok) throw new SheetLinkError(`Google Sheets answered ${res.status}. Try again, or download the sheet as XLSX and upload that.`)
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MAX_BYTES) throw new SheetLinkError('That sheet is over 5MB. Download it as XLSX and upload that.')
    const text = await res.text()
    if (text.length > MAX_BYTES) throw new SheetLinkError('That sheet is over 5MB. Download it as XLSX and upload that.')
    const type = (res.headers.get('content-type') || '').toLowerCase()
    if (type.includes('text/html') || /^\s*<(!doctype|html)/i.test(text)) throw new SheetLinkError(PRIVATE_SHEET)
    return text
  }
  throw new SheetLinkError(PRIVATE_SHEET)
}
