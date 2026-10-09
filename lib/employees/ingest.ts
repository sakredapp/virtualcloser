/**
 * "Give it to Mira" for Employees (server side). An exec drops any file
 * (XLSX/CSV/PDF/DOCX), a Google Sheets link or pasted text; Claude Sonnet
 * reads it into people, quotas, bonus tiers, HR basics and time off; the exec
 * reviews; `applyReview` saves. Nothing is saved before the review.
 */
import * as XLSX from 'xlsx'
import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, runWithClaudeKey } from '@/lib/anthropic'
import { fetchSheetCsv } from '@/lib/plan/sheetLink'
import { supabase } from '@/lib/supabase'
import { addTimeOff, isLocked, saveActual, saveKpi, saveTiers, upsertEmployee, type EmployeesData } from './data'
import { buildReview, claudeCostUsd, cleanPerson, type RawPerson, type ReviewItem } from './ingestShared'
import { matchEmployee, QUOTA_TYPES } from './shared'
import { emptyHidden, fillPayBack, redactCsvText, redactWorkbook, type HiddenPay, type RawPersonWithRows } from './payRedact'

const MODEL = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'
const MAX_CHARS = 120_000

/**
 * What Claude reads: text, or a PDF sent as a document (no PDF library on the
 * server). `hidden` = pay values held back from a spreadsheet (see payRedact).
 */
export type IngestDoc = { text: string; hidden?: HiddenPay } | { pdfBase64: string }

/**
 * An uploaded file. Spreadsheets become CSV, one block per sheet, with pay
 * columns blanked (values kept here); PDFs go to Claude as-is.
 */
export async function textFromUpload(file: { name: string; type: string; buffer: Buffer }): Promise<IngestDoc> {
  const name = file.name.toLowerCase()
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name) || /spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(file.type)) {
    const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true })
    const r = redactWorkbook(wb)
    return { text: r.text.slice(0, MAX_CHARS), hidden: r.hidden }
  }
  if (/\.(csv|tsv)$/.test(name) || /text\/(csv|tab-separated-values)/.test(file.type)) {
    const r = redactCsvText(file.buffer.toString('utf8'))
    return { text: r.text.slice(0, MAX_CHARS), hidden: r.hidden }
  }
  if (/\.(txt|md)$/.test(name) || file.type.startsWith('text/')) return { text: file.buffer.toString('utf8').slice(0, MAX_CHARS) }
  if (name.endsWith('.pdf') || file.type === 'application/pdf' || file.buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { pdfBase64: file.buffer.toString('base64') }
  }
  if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    const mammoth = (await import('mammoth')).default
    const { value } = await mammoth.extractRawText({ buffer: file.buffer })
    return { text: value.slice(0, MAX_CHARS) }
  }
  throw new IngestFileError('Upload an XLSX, CSV, PDF or Word file, or paste the rows.')
}

export class IngestFileError extends Error {}

/** A Google Sheet as CSV, pay columns held back like an upload. */
export async function textFromSheetLink(url: string): Promise<{ text: string; hidden: HiddenPay }> {
  const r = redactCsvText(await fetchSheetCsv(url))
  return { text: r.text.slice(0, MAX_CHARS), hidden: r.hidden }
}

const num = { type: ['number', 'string', 'null'] }
const TOOL = {
  name: 'record_employees',
  description: 'Record every employee found in the document with their quotas, bonus tiers, HR basics and time off.',
  input_schema: {
    type: 'object',
    properties: {
      people: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: ['string', 'null'] },
            title: { type: ['string', 'null'] },
            department: { type: ['string', 'null'] },
            manager: { type: ['string', 'null'], description: 'Name of the person they report to' },
            start_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
            base_salary: { ...num, description: 'Annual salary in dollars' },
            hourly_rate: { ...num, description: 'Dollars per hour' },
            hours_per_week: num,
            pto_allowed_days: { ...num, description: 'PTO days allowed per year' },
            pto_balance_days: { ...num, description: 'PTO days left now' },
            book_name: { type: ['string', 'null'], description: 'Agent or team name this person is credited under in production reports, if different from their name' },
            source_rows: { type: 'array', items: { type: 'string' }, description: 'The row_id value of every row this person came from, when the document has a row_id column' },
            quotas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: QUOTA_TYPES.map((q) => q.type) },
                  name: { type: 'string', description: 'Short label, e.g. "Submitted premium" or the custom metric name' },
                  target: num,
                  period: { type: 'string', enum: ['month', 'quarter', 'year'] },
                  period_key: { type: ['string', 'null'], description: 'YYYY-MM, YYYY-Q1..Q4 or YYYY when the document names the period' },
                  actual: { ...num, description: 'Progress so far in that period, only if the document states it' },
                  tiers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        attain_pct: { type: 'number', description: '100 = 100% of quota' },
                        bonus: { type: 'number', description: 'Dollars' },
                        bonus_column: { type: 'string', description: 'When the dollars sit in a blanked pay column: that column header, instead of bonus' },
                      },
                      required: ['attain_pct'],
                    },
                  },
                },
                required: ['type', 'target', 'period'],
              },
            },
            time_off: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  start_date: { type: 'string', description: 'YYYY-MM-DD' },
                  end_date: { type: ['string', 'null'] },
                  days: num,
                  kind: { type: 'string', enum: ['vacation', 'sick', 'personal', 'other'] },
                  note: { type: ['string', 'null'] },
                },
                required: ['start_date', 'kind'],
              },
            },
          },
          required: ['name'],
        },
      },
      unreadable: { type: 'array', items: { type: 'string' }, description: 'Anything you could not read or were unsure of, one short line each' },
    },
    required: ['people'],
  },
} as const

export type ParseResult = { people: RawPerson[]; unreadable: string[]; usage: { input_tokens: number; output_tokens: number }; costUsd: number; model: string }

/** Claude reads the text into people. Only facts in the text; never invented. */
export async function parseWithClaude(doc: IngestDoc, today: string, claudeKey: string | null): Promise<ParseResult> {
  const isPdf = 'pdfBase64' in doc
  const hidden = !isPdf && doc.hidden ? doc.hidden : emptyHidden()
  const held = hidden.columns.length > 0
  const prompt = [
    `Today is ${today}. Below is a document an executive uploaded about their employees: a roster, quota sheet, bonus plan, payroll or time-off log, or a mix.`,
    'Call record_employees once with every person in it. Rules:',
    '- Use only what the document says. Never guess a number, a date or an email. Leave a field out when it is not there.',
    '- Quota type: revenue = revenue/sales dollars; premium = insurance premium dollars (AP, annualised premium); policies = policy or deal counts (apps, submitted, issued); recruits = new agents/hires; appointments = appointments or meetings set; custom = anything else (give it a short name).',
    '- Period: month, quarter or year as the document states. A "Q1 quota" is quarter with period_key YYYY-Q1.',
    '- Bonus tiers: attain_pct is the % of quota (80, 100, 120), bonus is dollars.',
    '- Time off: one entry per absence with dates and kind (vacation, sick, personal, other).',
    '- List anything you could not read in unreadable.',
    ...(held
      ? [
          `- The pay columns (${hidden.columns.join(', ')}) are blank on purpose: pay stays on the company's server. Do not fill base_salary or hourly_rate, and do not list those columns as unreadable.`,
          '- For every person give source_rows: the row_id of each row they came from. If a bonus tier\'s dollars sit in a blank pay column, give that column header as bonus_column instead of bonus.',
        ]
      : []),
    '',
    ...(isPdf ? ['The document is the attached PDF.'] : ['--- DOCUMENT ---', doc.text.slice(0, MAX_CHARS)]),
  ].join('\n')
  const content: Anthropic.MessageParam['content'] = isPdf
    ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.pdfBase64 } }, { type: 'text', text: prompt }]
    : prompt
  const msg = await runWithClaudeKey(claudeKey, () =>
    getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 16_000,
      tools: [TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: 'tool', name: 'record_employees' },
      messages: [{ role: 'user', content }],
    }),
  )
  const block = msg.content.find((b) => b.type === 'tool_use') as { input?: { people?: RawPersonWithRows[]; unreadable?: string[] } } | undefined
  const usage = { input_tokens: msg.usage?.input_tokens ?? 0, output_tokens: msg.usage?.output_tokens ?? 0 }
  const people = Array.isArray(block?.input?.people) ? block!.input!.people! : []
  return {
    // Pay values go back on locally, by row; Claude never saw them.
    people: fillPayBack(people, hidden),
    unreadable: Array.isArray(block?.input?.unreadable) ? block!.input!.unreadable!.slice(0, 20).map((s) => String(s).slice(0, 200)) : [],
    usage,
    costUsd: claudeCostUsd(usage),
    model: MODEL,
  }
}

export function reviewFor(people: RawPerson[], data: EmployeesData, today: string, comp: boolean): ReviewItem[] {
  return buildReview(people, data.employees, data.kpis, today, comp)
}

export type ApplyDecision = { key: string; skip?: boolean; employee_id?: string | null; person: RawPerson }

/**
 * Save the reviewed rows. Every row is cleaned again here; an ambiguous row
 * needs an employee_id (or 'new') picked by the exec.
 */
export async function applyReview(
  repId: string,
  decisions: ApplyDecision[],
  data: EmployeesData,
  today: string,
  comp: boolean,
): Promise<{ added: number; updated: number; quotas: number; actuals: number; timeOff: number; skipped: number; problems: string[] }> {
  const out = { added: 0, updated: 0, quotas: 0, actuals: 0, timeOff: 0, skipped: 0, problems: [] as string[] }
  const people = [...data.employees]
  const kpis = [...data.kpis]
  const pendingManagers: Array<{ id: string; manager: string }> = []
  for (const d of decisions.slice(0, 500)) {
    if (d.skip) {
      out.skipped++
      continue
    }
    const { person, problems } = cleanPerson(d.person ?? {}, today, comp)
    if (!person) {
      out.skipped++
      continue
    }
    for (const p of problems) out.problems.push(`${person.name}: ${p}`)
    let empId: string | null = null
    if (d.employee_id && d.employee_id !== 'new') {
      if (!people.some((p) => p.id === d.employee_id)) {
        out.problems.push(`${person.name}: the person picked is not on the list any more; skipped.`)
        out.skipped++
        continue
      }
      empId = d.employee_id
    } else if (d.employee_id !== 'new') {
      const m = matchEmployee(people, person.name, person.email)
      if (m.match) empId = m.match.id
      else if (m.candidates.length > 0) {
        out.problems.push(`${person.name}: could be ${m.candidates.map((c) => c.name).join(' or ')}; pick one. Skipped.`)
        out.skipped++
        continue
      }
    }
    const input = {
      name: person.name,
      ...(person.title ? { title: person.title } : {}),
      ...(person.department ? { department: person.department } : {}),
      ...(person.start_date ? { start_date: person.start_date } : {}),
      ...(person.email ? { email: person.email } : {}),
      ...(comp && person.base_salary != null ? { base_salary: person.base_salary } : {}),
      ...(comp && person.hourly_rate != null ? { hourly_rate: person.hourly_rate } : {}),
      ...(person.hours_per_week != null ? { hours_per_week: person.hours_per_week } : {}),
      ...(person.pto_allowed_days != null ? { pto_allowed_days: person.pto_allowed_days } : {}),
      ...(person.pto_balance_days != null ? { pto_balance_days: person.pto_balance_days } : {}),
      ...(person.book_name ? { book_match: person.book_name, book_dim: 'agent' as const } : {}),
    }
    const wasNew = !empId
    empId = await upsertEmployee(repId, empId, input, comp)
    if (wasNew) {
      out.added++
      people.push({ id: empId, name: person.name, email: person.email } as (typeof people)[number])
    } else out.updated++
    if (person.manager) pendingManagers.push({ id: empId, manager: person.manager })

    for (const q of person.quotas) {
      const existing = kpis.find((k) => k.employee_id === empId && k.quota_type === q.quota_type && k.period === q.period && (q.quota_type !== 'custom' || k.name.toLowerCase() === q.name.toLowerCase()))
      const info = QUOTA_TYPES.find((t) => t.type === q.quota_type)!
      const kpiId = await saveKpi(repId, {
        id: existing?.id,
        employee_id: empId,
        name: q.name,
        unit: info.unit,
        target: q.target,
        period: q.period,
        quota_type: q.quota_type,
        actual_source: existing?.actual_source ?? 'manual',
        weight: existing?.weight ?? 1,
        lower_is_better: false,
        sort: existing?.sort ?? kpis.filter((k) => k.employee_id === empId).length,
      })
      if (!existing) kpis.push({ id: kpiId, employee_id: empId, name: q.name, unit: info.unit, target: q.target, period: q.period, weight: 1, lower_is_better: false, sort: 0, quota_type: q.quota_type, actual_source: 'manual' })
      out.quotas++
      if (q.actual != null) {
        if (await isLocked(repId, q.period_key)) out.problems.push(`${person.name}: ${q.period_key} is approved for payroll, so the actual was not changed.`)
        else {
          await saveActual(repId, kpiId, q.period_key, q.actual, 'import')
          out.actuals++
        }
      }
      if (comp && q.tiers.length) await saveTiers(repId, empId, q.period, kpiId, q.tiers)
    }
    if (person.time_off.length) {
      const { data: have } = await supabase.from('cxo_employee_time_off').select('start_date, kind').eq('rep_id', repId).eq('employee_id', empId).limit(2000)
      const seen = new Set((have ?? []).map((h) => `${h.start_date}|${h.kind}`))
      for (const t of person.time_off) {
        if (seen.has(`${t.start_date}|${t.kind}`)) continue
        await addTimeOff(repId, { employee_id: empId, start_date: t.start_date, end_date: t.end_date, days: t.days, kind: t.kind, note: t.note, source: 'import' })
        seen.add(`${t.start_date}|${t.kind}`)
        out.timeOff++
      }
    }
  }
  // Managers last, so a manager added in the same file is found.
  for (const pm of pendingManagers) {
    const m = matchEmployee(people.filter((p) => p.id !== pm.id), pm.manager, null)
    if (m.match) await upsertEmployee(repId, pm.id, { manager_id: m.match.id }, comp)
    else out.problems.push(`Manager "${pm.manager}" is not on the list, so that reporting line was left out.`)
  }
  return out
}
