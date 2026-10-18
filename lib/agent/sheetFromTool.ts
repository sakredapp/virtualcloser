/**
 * Build a sheet table straight from a read tool's JSON result, so a "put that
 * in a sheet" never makes the model retype 30 rows (Ciao refinement
 * 2026-10-18: those exports took 40s and hit the time limit).
 *
 * Takes the largest list of row objects in the result (ranked, producers,
 * carriers, went_quiet ...) and turns it into a header row plus data rows.
 * Nested objects and lists are skipped; numbers stay plain digits.
 */

/** Read tools a sheet may be filled from (each still goes through the role wall). */
export const SHEET_SOURCE_TOOLS = ['producer_production'] as const
export type SheetSourceTool = (typeof SHEET_SOURCE_TOOLS)[number]

export function isSheetSourceTool(v: unknown): v is SheetSourceTool {
  return typeof v === 'string' && (SHEET_SOURCE_TOOLS as readonly string[]).includes(v)
}

const HEADER_LABEL: Record<string, string> = {
  name: 'Producer',
  team: 'Agency',
  submitted_ap: 'Submitted AP',
  issued_ap: 'Issued AP',
  applications: 'Policies written',
  policies: 'Policies written',
  placement_pct: 'Placement %',
  persistency_pct: 'Persistency %',
  first_policy: 'First policy',
  contracted_at: 'Contracted',
}

function label(key: string): string {
  if (HEADER_LABEL[key]) return HEADER_LABEL[key]
  const words = key.replace(/_pct$/, ' %').replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function isRowList(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === 'object' && !Array.isArray(r))
}

/** The table inside a tool result, or null when there is no list of rows. */
export function tableFromToolResult(result: unknown): string[][] | null {
  if (!result || typeof result !== 'object') return null
  const lists = Object.values(result as Record<string, unknown>).filter(isRowList)
  if (!lists.length) return null
  const rows = lists.reduce((a, b) => (b.length > a.length ? b : a))
  // Columns: scalar keys in first-seen order across all rows; "value" repeats the ranked metric.
  const keys: string[] = []
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (k === 'value' || keys.includes(k)) continue
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) keys.push(k)
    }
  }
  if (!keys.length) return null
  // Rank first when present.
  keys.sort((a, b) => (a === 'rank' ? -1 : b === 'rank' ? 1 : 0))
  const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v))
  return [keys.map(label), ...rows.map((r) => keys.map((k) => cell(r[k])))]
}
