// Payroll Google Sheets connector. Lets Lauren connect MULTIPLE sheets and pull
// her data in — reusing the app's existing Google OAuth (spreadsheets scope)
// and Sheets helpers in lib/google.

import { supabase } from '@/lib/supabase'
import { parseSheetId, getSheetMeta, readSheetRange } from '@/lib/google'

export type ConnectedSheet = {
  id: string
  rep_id: string
  spreadsheet_id: string
  title: string | null
  label: string | null
  default_tab: string | null
  created_at: string
}

export async function listSheets(repId: string): Promise<ConnectedSheet[]> {
  const { data } = await supabase
    .from('payroll_sheets')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false })
  return (data ?? []) as ConnectedSheet[]
}

export async function getSheet(repId: string, id: string): Promise<ConnectedSheet | null> {
  const { data } = await supabase.from('payroll_sheets').select('*').eq('rep_id', repId).eq('id', id).maybeSingle()
  return (data as ConnectedSheet | null) ?? null
}

/** Connect a sheet by URL/ID. Returns {ok} or a reason (e.g. not connected to Google). */
export async function connectSheet(
  repId: string,
  urlOrId: string,
  label: string | null,
  memberId: string | null = null,
): Promise<{ ok: boolean; error?: string }> {
  const spreadsheetId = parseSheetId(urlOrId)
  if (!spreadsheetId) return { ok: false, error: 'Could not read a Google Sheet ID from that — paste the full sheet URL.' }
  const meta = await getSheetMeta(repId, spreadsheetId, memberId)
  if (!meta) return { ok: false, error: "Couldn't open that sheet. Make sure Google is connected (Integrations) and the sheet is shared with your Google account." }
  const { error } = await supabase.from('payroll_sheets').upsert(
    {
      rep_id: repId,
      spreadsheet_id: spreadsheetId,
      title: meta.title || null,
      label: label?.trim() || null,
      default_tab: meta.tabs[0] ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'rep_id,spreadsheet_id' },
  )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function removeSheet(repId: string, id: string): Promise<void> {
  await supabase.from('payroll_sheets').delete().eq('rep_id', repId).eq('id', id)
}

export async function sheetTabs(repId: string, spreadsheetId: string, memberId: string | null = null): Promise<string[]> {
  const meta = await getSheetMeta(repId, spreadsheetId, memberId)
  return meta?.tabs ?? []
}

export type SheetPreview = { headers: string[]; rows: string[][]; total: number }

export async function previewSheet(
  repId: string,
  spreadsheetId: string,
  tab: string,
  memberId: string | null = null,
): Promise<SheetPreview | null> {
  const range = tab ? `${tab}!A1:Z200` : 'A1:Z200'
  const values = await readSheetRange(repId, spreadsheetId, range, memberId)
  if (!values) return null
  const headers = values[0] ?? []
  const rows = values.slice(1)
  return { headers, rows: rows.slice(0, 50), total: rows.length }
}

// ── Heuristic import into commission_entries ──────────────────────────────

const FIELD_HINTS: Record<string, string[]> = {
  agent_name: ['agent', 'rep', 'producer', 'writing agent', 'writing'],
  client_name: ['client', 'insured', 'customer', 'member', 'policy holder', 'name'],
  carrier: ['carrier', 'company', 'insurer'],
  product: ['product', 'plan', 'policy type', 'coverage'],
  premium: ['premium', 'annual premium', 'ap', 'face', 'sale amount'],
  commission_amount: ['commission', 'comp', 'payout', 'comm', 'override'],
  sale_date: ['date', 'effective', 'sale date', 'submitted', 'issued'],
}

function matchHeader(header: string): string | null {
  const h = header.trim().toLowerCase()
  if (!h) return null
  for (const [field, hints] of Object.entries(FIELD_HINTS)) {
    if (hints.some((hint) => h === hint || h.includes(hint))) return field
  }
  return null
}

function toNumber(v: string | undefined): number {
  if (!v) return 0
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export type ImportResult = { imported: number; mapping: Record<string, string>; skipped: number }

export async function importCommissionsFromSheet(
  repId: string,
  spreadsheetId: string,
  tab: string,
  memberId: string | null = null,
): Promise<ImportResult | null> {
  const range = tab ? `${tab}!A1:Z2000` : 'A1:Z2000'
  const values = await readSheetRange(repId, spreadsheetId, range, memberId)
  if (!values || values.length < 2) return { imported: 0, mapping: {}, skipped: 0 }
  const headers = values[0]
  const colToField = new Map<number, string>()
  const mapping: Record<string, string> = {}
  headers.forEach((h, i) => {
    const field = matchHeader(h)
    if (field && !Object.values(mapping).includes(field)) {
      colToField.set(i, field)
      mapping[h] = field
    }
  })
  if (colToField.size === 0) return { imported: 0, mapping: {}, skipped: values.length - 1 }

  const rows = values.slice(1, 2001)
  const toInsert: Array<Record<string, unknown>> = []
  let skipped = 0
  for (const row of rows) {
    const entry: Record<string, unknown> = { rep_id: repId, status: 'expected' }
    let hasAny = false
    for (const [col, field] of colToField) {
      const raw = row[col]
      if (raw == null || String(raw).trim() === '') continue
      if (field === 'premium' || field === 'commission_amount') entry[field] = toNumber(raw)
      else if (field === 'sale_date') entry[field] = String(raw).slice(0, 32)
      else entry[field] = String(raw).slice(0, 200)
      hasAny = true
    }
    // Only import rows that have a name or money — skip blank/total rows.
    if (hasAny && (entry.agent_name || entry.client_name || Number(entry.commission_amount) > 0)) {
      entry.notes = `imported from sheet`
      toInsert.push(entry)
    } else {
      skipped++
    }
  }
  let imported = 0
  // Insert in chunks to stay well within payload limits.
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200)
    const { error, count } = await supabase.from('commission_entries').insert(chunk, { count: 'exact' })
    if (!error) imported += count ?? chunk.length
  }
  return { imported, mapping, skipped }
}
