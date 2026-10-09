/**
 * Reading an uploaded plan or comp grid. Server side only.
 *
 * Tidy sheets are read by rule (free). Anything else — a messy workbook, a
 * PDF rate sheet — goes to the AI through one forced tool call, and what it
 * cost is kept with the upload. Sheets (text) run on GLM via lib/aiProvider;
 * a PDF is the VISION EXCEPTION and runs on Claude Sonnet. Never Haiku. Nothing here saves; the result is a draft for the review step.
 */
import * as XLSX from 'xlsx'
import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, hasAnthropicKey } from '@/lib/anthropic'
import { estimateCostUsd } from '@/lib/aiProvider'
import { MONTHS, parseAmount, readTable } from './shared'
import {
  mergePlanRows,
  normaliseRateScale,
  parseMonthYear,
  readCompTable,
  readPlanTable,
  type CompDraft,
  type CompDraftRow,
  type Draft,
  type PlanDraft,
  type PlanDraftRow,
  type StatedTotal,
  type Table,
  type UploadKind,
  type UploadSource,
} from './importShared'

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
// Only used on the Anthropic paths; lib/aiProvider picks GLM for text and the
// vision model for a PDF.
const MODEL = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'
/** Sheet text sent to Claude is capped so one upload can't cost much. */
const MAX_SHEET_CHARS = 120_000

export class UploadError extends Error {}

/** What kind of file this is, from its name (and first bytes when the name says nothing). */
export function sourceOf(filename: string, bytes: Uint8Array): UploadSource | null {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx'
  if (ext === 'xls') return 'xls'
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv'
  if (ext === 'pdf') return 'pdf'
  const head = String.fromCharCode(...bytes.slice(0, 5))
  if (head === '%PDF-') return 'pdf'
  if (head.startsWith('PK')) return 'xlsx'
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return 'xls'
  return null
}

const trimRow = (r: string[]) => {
  const out = r.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim())
  while (out.length && !out[out.length - 1]) out.pop()
  return out
}

/** A spreadsheet file (or CSV text) → its sheets as rows of text, as they are shown in Excel. */
export function tablesFrom(source: UploadSource, bytes: Uint8Array | null, text?: string): Table[] {
  if (source === 'csv' || source === 'sheet') {
    const t = text ?? new TextDecoder().decode(bytes ?? new Uint8Array())
    return [{ name: source === 'sheet' ? 'Sheet' : 'File', rows: readTable(t).map(trimRow) }]
  }
  if (source === 'xlsx' || source === 'xls') {
    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(bytes, { type: 'array', cellDates: false })
    } catch {
      throw new UploadError("That file couldn't be opened as a spreadsheet. Save it as XLSX or CSV and try again.")
    }
    return wb.SheetNames.filter((n) => !wb.Workbook?.Sheets?.find((s) => s.name === n)?.Hidden).map((name) => {
      const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false })
      return { name, rows: rows.map((r) => trimRow(r.map((c) => String(c ?? '')))) }
    })
  }
  return []
}

function tablesAsText(tables: Table[]): string {
  let out = ''
  for (const t of tables) {
    const rows = t.rows.filter((r) => r.some(Boolean))
    if (!rows.length) continue
    out += `### Sheet: ${t.name}\n`
    for (const r of rows) out += r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',') + '\n'
    out += '\n'
  }
  return out.length > MAX_SHEET_CHARS ? out.slice(0, MAX_SHEET_CHARS) + '\n[cut off: file too long]\n' : out
}

// ── Claude ──────────────────────────────────────────────────────────────

const PLAN_TOOL: Anthropic.Tool = {
  name: 'record_plan',
  description: 'Record every planned sales figure found in the document.',
  input_schema: {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        description: 'One entry per product × carrier × measure (and year, if the document covers several years). Do not include total or subtotal lines here.',
        items: {
          type: 'object',
          properties: {
            product: { type: 'string', description: 'Product or line, as written (e.g. "Final Expense", "IUL", "Medicare Supplement"). Empty if the document has none.' },
            carrier: { type: 'string', description: 'Carrier, as written. Empty if the document has none.' },
            measure: { type: 'string', enum: ['premium', 'policies'], description: 'premium = dollars of premium; policies = count of policies/apps.' },
            year: { type: ['integer', 'null'], description: 'The year these figures are for, if stated.' },
            months: { type: ['array', 'null'], items: { type: ['number', 'null'] }, description: '12 numbers Jan..Dec, null for a month with no figure. Null when only a yearly figure is given.' },
            annual_total: { type: ['number', 'null'], description: 'The yearly figure. Required when months is null; otherwise the stated row total if one is shown.' },
          },
          required: ['product', 'carrier', 'measure', 'months', 'annual_total'],
        },
      },
      stated_totals: {
        type: 'array',
        description: 'Premium totals/subtotals the document itself prints, so they can be checked against the lines.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: 'number' },
            month: { type: ['integer', 'null'], description: '1..12 when the total is for one month, else null for the year.' },
            product: { type: ['string', 'null'], description: 'Set when the total covers one product only.' },
            carrier: { type: ['string', 'null'], description: 'Set when the total covers one carrier only.' },
          },
          required: ['label', 'value'],
        },
      },
      notes: { type: 'array', items: { type: 'string' }, description: 'At most 3 short plain sentences an executive needs to know (e.g. a part that could not be read, a yearly figure with no monthly split). No technical words such as null, field or array. Do not repeat titles or labels from the file.' },
    },
    required: ['lines'],
  },
}

const COMP_TOOL: Anthropic.Tool = {
  name: 'record_comp_grid',
  description: 'Record every carrier × product commission row found in the document.',
  input_schema: {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            carrier: { type: 'string', description: 'Carrier, as written.' },
            product: { type: 'string', description: 'Product, as written. Empty when the rate covers all of the carrier\'s products.' },
            agency_rate: { type: ['number', 'null'], description: 'The agency\'s own contract level / top comp, in percent of premium as printed (110 for 110%). Null if not shown.' },
            agent_levels: {
              type: 'array',
              description: 'The agent payout levels the agency pays, each with its name as printed and its percent.',
              items: { type: 'object', properties: { level: { type: 'string' }, rate: { type: 'number' } }, required: ['level', 'rate'] },
            },
          },
          required: ['carrier', 'product', 'agency_rate', 'agent_levels'],
        },
      },
      notes: { type: 'array', items: { type: 'string' }, description: 'At most 3 short plain sentences an executive needs to know. No technical words such as null, field or array. Do not repeat titles or labels from the file.' },
    },
    required: ['rows'],
  },
}

const SYSTEM = [
  'You read insurance agency spreadsheets and rate sheets and copy their figures exactly into the tool call.',
  'Copy numbers as printed. Never estimate, fill in, or invent a figure, a carrier or a product.',
  'Skip blank rows, headings and notes. Keep carrier and product names as written (the app matches spellings itself).',
].join(' ')

type ClaudeOut<T> = { input: T; costUsd: number }

async function askClaude<T>(tool: Anthropic.Tool, content: Anthropic.ContentBlockParam[]): Promise<ClaudeOut<T>> {
  if (!hasAnthropicKey()) throw new UploadError("This layout needs the AI reader, which isn't set up. Upload a sheet with one row per product and carrier and months across.")
  const res = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content }],
  })
  // Priced by the model that actually ran (GLM or the Sonnet vision exception).
  const costUsd = estimateCostUsd(res.model, res.usage.input_tokens, res.usage.output_tokens)
  const block = res.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new UploadError("The file couldn't be read. Try an XLSX or CSV copy.")
  if (res.stop_reason === 'max_tokens') throw new UploadError('That file has more rows than one upload can read. Split it into smaller files.')
  return { input: block.input as T, costUsd: Math.round(costUsd * 10000) / 10000 }
}

function fileContent(source: UploadSource, bytes: Uint8Array | null, tables: Table[], ask: string): Anthropic.ContentBlockParam[] {
  if (source === 'pdf') {
    return [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes ?? new Uint8Array()).toString('base64') } },
      { type: 'text', text: ask },
    ]
  }
  return [{ type: 'text', text: `${ask}\n\nThe file, sheet by sheet, as CSV:\n\n${tablesAsText(tables)}` }]
}

type ClaudePlan = {
  lines?: Array<{ product?: string; carrier?: string; measure?: string; year?: number | null; months?: Array<number | null> | null; annual_total?: number | null }>
  stated_totals?: Array<{ label?: string; value?: number; month?: number | null; product?: string | null; carrier?: string | null }>
  notes?: string[]
}
type ClaudeComp = {
  rows?: Array<{ carrier?: string; product?: string; agency_rate?: number | null; agent_levels?: Array<{ level?: string; rate?: number }> }>
  notes?: string[]
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : parseAmount(v))

export function planFromClaude(out: ClaudePlan): { rows: PlanDraftRow[]; totals: StatedTotal[] } {
  const rows: PlanDraftRow[] = []
  let id = 1
  for (const [i, l] of (out.lines ?? []).entries()) {
    const product = String(l.product ?? '').trim()
    const carrier = String(l.carrier ?? '').trim()
    if (!product && !carrier) continue
    const field = l.measure === 'policies' ? 'policies' : 'premium'
    const src = `line ${i + 1}`
    const year = typeof l.year === 'number' ? l.year : null
    const months = Array.isArray(l.months) ? l.months.slice(0, 12) : null
    if (months && months.some((v) => num(v) != null)) {
      months.forEach((v, k) => {
        const n = num(v)
        if (n == null) return
        rows.push({ id: id++, year, month: k + 1, product, carrier, premium: field === 'premium' ? n : null, policies: field === 'policies' ? n : null, src })
      })
    } else {
      const n = num(l.annual_total)
      if (n == null) continue
      rows.push({ id: id++, year, month: null, product, carrier, premium: field === 'premium' ? n : null, policies: field === 'policies' ? n : null, src })
    }
  }
  const totals: StatedTotal[] = []
  for (const t of out.stated_totals ?? []) {
    const v = num(t.value)
    if (v == null) continue
    const month = typeof t.month === 'number' && t.month >= 1 && t.month <= 12 ? t.month : null
    totals.push({ label: String(t.label || 'Total') + (month ? ` ${MONTHS[month - 1]}` : ''), value: v, month, product: t.product?.trim() || null, carrier: t.carrier?.trim() || null, src: 'stated in the file' })
  }
  return { rows: mergePlanRows(rows), totals }
}

export function compFromClaude(out: ClaudeComp): CompDraftRow[] {
  const rows: CompDraftRow[] = []
  let id = 1
  for (const [i, r] of (out.rows ?? []).entries()) {
    const carrier = String(r.carrier ?? '').trim()
    if (!carrier) continue
    const levels = (r.agent_levels ?? []).map((l) => ({ level: String(l.level ?? '').trim() || 'Agent', rate: num(l.rate) })).filter((l): l is { level: string; rate: number } => l.rate != null)
    rows.push({ id: id++, carrier, product: String(r.product ?? '').trim(), agency_rate: num(r.agency_rate), agent_levels: levels, src: `row ${i + 1}` })
  }
  return rows
}

export type ReadInput = { kind: UploadKind; year: number; filename: string; source: UploadSource; bytes: Uint8Array | null; text?: string }

/** Read an upload into a draft for review. Rules first; Claude only when the rules can't. */
export async function readUpload(input: ReadInput): Promise<Draft> {
  const { kind, year, filename, source, bytes, text } = input
  const tables = source === 'pdf' ? [] : tablesFrom(source, bytes, text)
  if (source !== 'pdf' && !tables.some((t) => t.rows.some((r) => r.some(Boolean)))) throw new UploadError('That file is empty.')
  const notes: string[] = []

  if (kind === 'plan') {
    if (source !== 'pdf') {
      let rows: PlanDraftRow[] = []
      let totals: StatedTotal[] = []
      let anyFailed = false
      for (const t of tables) {
        if (!t.rows.some((r) => r.some(Boolean))) continue
        const r = readPlanTable(t, rows.length + 1)
        if (r.ok) {
          rows = rows.concat(r.rows)
          totals = totals.concat(r.totals)
        } else if (r.dataRows > 0 || t.rows.length > 2) anyFailed = true
      }
      if (rows.length && !anyFailed) {
        const merged = mergePlanRows(rows).map((r, i) => ({ ...r, id: i + 1 }))
        return { kind: 'plan', year, filename, source, readBy: 'rules', costUsd: 0, notes, rows: merged, totals }
      }
    }
    const ask = `This is an insurance agency's sales plan (targets) for ${year}. Record every planned premium (and policy count, if given) by product, carrier and month.`
    const { input: out, costUsd } = await askClaude<ClaudePlan>(PLAN_TOOL, fileContent(source, bytes, tables, ask))
    const { rows, totals } = planFromClaude(out)
    if (!rows.length) throw new UploadError("No plan figures were found in that file. It needs premium by product or carrier, by month or for the year.")
    return { kind: 'plan', year, filename, source, readBy: 'claude', costUsd, notes: (out.notes ?? []).slice(0, 5).map(String), rows: rows.map((r, i) => ({ ...r, id: i + 1 })), totals }
  }

  let rows: CompDraftRow[] = []
  let readBy: 'rules' | 'claude' = 'rules'
  let costUsd = 0
  if (source !== 'pdf') {
    let anyFailed = false
    for (const t of tables) {
      if (!t.rows.some((r) => r.some(Boolean))) continue
      const r = readCompTable(t, rows.length + 1)
      if (r.ok) rows = rows.concat(r.rows)
      else if (r.dataRows > 0 || t.rows.length > 2) anyFailed = true
    }
    if (anyFailed) rows = []
  }
  if (!rows.length) {
    const ask = 'This is an insurance agency comp grid / rate sheet. Record, for every carrier and product, the agency\'s contract level (its own comp from the carrier) and each agent payout level the agency pays.'
    const res = await askClaude<ClaudeComp>(COMP_TOOL, fileContent(source, bytes, tables, ask))
    rows = compFromClaude(res.input)
    costUsd = res.costUsd
    readBy = 'claude'
    notes.push(...(res.input.notes ?? []).slice(0, 5).map(String))
  }
  if (!rows.length) throw new UploadError('No commission rates were found in that file. It needs carriers with the agency level and agent levels.')
  const scaled = normaliseRateScale(rows)
  if (scaled.scaled) notes.push('Rates were written as decimals (1.10), read as percents (110%).')
  const draft: CompDraft = { kind: 'comp', filename, source, readBy, costUsd, notes, rows: scaled.rows.map((r, i) => ({ ...r, id: i + 1 })) }
  return draft
}

export type { PlanDraft }
export { parseMonthYear }
