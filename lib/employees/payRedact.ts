/**
 * Pay columns never go to the AI (owner 10-09: "make sure we're not leaking all
 * of their financial records into AI").
 *
 * For spreadsheets (XLSX, CSV, Google Sheets) the pay columns are found by
 * header, their values are blanked before the text goes to Claude, and each
 * data row gets a row_id. The header stays, so Claude still knows the column
 * exists. Claude answers with the row_ids each person came from; the values
 * are filled back here, on our server, by row.
 *
 * PDF and Word cannot be split by column, so they are not touched. Pure.
 */
import * as XLSX from 'xlsx'
import { toNum, type RawPerson, type RawQuota } from './ingestShared'

/** Pay values held back from Claude: row_id → header → cell text. */
export type HiddenPay = { columns: string[]; rows: Record<string, Record<string, string>> }

export const emptyHidden = (): HiddenPay => ({ columns: [], rows: {} })

const PAY_WORDS = /\b(salary|salaries|wages?|pay|rate|hourly|compensation|comp|bonus\s*(amount|amt|\$|payout|dollars))\b/i
const BONUS_ONLY = /^\s*bonus\s*\$?\s*$/i
const NOT_PAY = /(frequency|schedule|period|date|type|%|pct|percent|attain|quota|target|commission|split|grade|method)/i

/** True when a column header names pay. "Pay frequency", "Bonus %", "Commission rate" are not pay values. */
export function isPayHeader(header: string): boolean {
  const h = String(header ?? '').trim()
  if (!h || NOT_PAY.test(h)) return false
  return PAY_WORDS.test(h) || BONUS_ONLY.test(h)
}

/** Which person field a held-back pay cell belongs to. */
export function payKind(header: string, value: number): 'base_salary' | 'hourly_rate' | 'bonus' {
  const h = header.toLowerCase()
  if (/bonus/.test(h)) return 'bonus'
  if (/annual|yearly|salary|per year|\/\s*yr/.test(h)) return 'base_salary'
  if (/hour|hourly|wage|\/\s*hr|per hr/.test(h)) return 'hourly_rate'
  return value < 500 ? 'hourly_rate' : 'base_salary'
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const toCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n')

/**
 * Blank the pay columns of one sheet (rows of cells). Adds a leading row_id
 * column when anything was blanked; otherwise the rows come back unchanged.
 */
export function redactRows(rows: string[][], tag: string, hidden: HiddenPay): string[][] {
  let headerAt = -1
  let payCols: number[] = []
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i] ?? []
    const filled = cells.filter((c) => String(c ?? '').trim()).length
    const pay = cells.map((c, j) => (isPayHeader(String(c ?? '')) ? j : -1)).filter((j) => j >= 0)
    if (pay.length && filled >= 2) {
      headerAt = i
      payCols = pay
      break
    }
  }
  if (headerAt < 0) return rows
  const header = rows[headerAt].map((c) => String(c ?? '').trim())
  for (const j of payCols) if (!hidden.columns.includes(header[j])) hidden.columns.push(header[j])
  return rows.map((cells, i) => {
    if (i < headerAt) return ['', ...cells]
    if (i === headerAt) return ['row_id', ...cells]
    const id = `${tag}${i - headerAt}`
    const out = cells.map((c) => String(c ?? ''))
    for (const j of payCols) {
      const v = (out[j] ?? '').trim()
      if (v) (hidden.rows[id] ??= {})[header[j]] = v
      if (j < out.length) out[j] = ''
    }
    return [id, ...out]
  })
}

function sheetRows(ws: XLSX.WorkSheet): string[][] {
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: false, dateNF: 'yyyy-mm-dd' }).map((r) => r.map((c) => String(c ?? '')))
}

/** An XLSX workbook → CSV text per sheet with pay values held back. */
export function redactWorkbook(wb: XLSX.WorkBook, maxSheets = 12): { text: string; hidden: HiddenPay } {
  const hidden = emptyHidden()
  const parts = wb.SheetNames.slice(0, maxSheets).map((s, i) => `## Sheet: ${s}\n${toCsv(redactRows(sheetRows(wb.Sheets[s]), `s${i + 1}r`, hidden))}`)
  return { text: parts.join('\n\n'), hidden }
}

/** CSV/TSV text (an upload or a Google Sheet export) with pay values held back. */
export function redactCsvText(text: string): { text: string; hidden: HiddenPay } {
  const wb = XLSX.read(text, { type: 'string', raw: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { text, hidden: emptyHidden() }
  const hidden = emptyHidden()
  const rows = redactRows(sheetRows(ws), 'r', hidden)
  return hidden.columns.length ? { text: toCsv(rows), hidden } : { text, hidden }
}

/** What Claude may send back per person/tier beyond RawPerson when pay was held back. */
export type RawPersonWithRows = Omit<RawPerson, 'quotas'> & {
  source_rows?: unknown
  quotas?: Array<Omit<RawQuota, 'tiers'> & { tiers?: Array<{ attain_pct?: unknown; bonus?: unknown; bonus_column?: unknown }> }>
}

/** Put the held-back pay values back on each person, by the row_ids Claude named. */
export function fillPayBack(people: RawPersonWithRows[], hidden: HiddenPay): RawPerson[] {
  return people.map((p) => {
    const { source_rows, ...rest } = p
    const out: RawPerson = { ...rest, quotas: rest.quotas?.map((q) => ({ ...q, tiers: q.tiers?.map((t) => ({ attain_pct: t.attain_pct, bonus: t.bonus })) })) }
    const ids = Array.isArray(source_rows) ? source_rows.map((x) => String(x).trim()).filter(Boolean) : []
    const cells = ids.map((id) => hidden.rows[id]).filter(Boolean)
    for (const row of cells) {
      for (const [header, raw] of Object.entries(row)) {
        const v = toNum(raw)
        if (v == null) continue
        const kind = payKind(header, v)
        if (kind === 'bonus') continue
        if (out[kind] == null || out[kind] === '') out[kind] = v
      }
    }
    // Tier dollars that sat in a held-back column.
    rest.quotas?.forEach((q, qi) => {
      q.tiers?.forEach((t, ti) => {
        const col = typeof t.bonus_column === 'string' ? t.bonus_column.trim() : ''
        if (!col || (t.bonus != null && t.bonus !== '')) return
        const hit = cells.find((r) => r[col] != null)
        const v = hit ? toNum(hit[col]) : null
        if (v != null) out.quotas![qi].tiers![ti].bonus = v
      })
    })
    return out
  })
}
