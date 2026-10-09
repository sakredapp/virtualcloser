/**
 * "Import a board": turn a board export (Trello JSON, from a link or a file),
 * a spreadsheet (CSV / tab-separated rows) or a pasted task list into one
 * payload for /api/boards. Pure functions: the page uses them for files and
 * pasted text, the server uses them for links it fetched.
 */
import type { ImportPayload } from '@/lib/boardsShared'

type Lists = ImportPayload['lists']
type Card = Lists[number]['cards'][number]

type ExportJson = {
  name?: string
  lists?: Array<{ id: string; name: string; closed?: boolean; pos?: number }>
  cards?: Array<{ id: string; idList: string; name: string; desc?: string; due?: string | null; closed?: boolean; dueComplete?: boolean; pos?: number; labels?: Array<{ name?: string; color?: string | null }> }>
  checklists?: Array<{ idCard: string; pos?: number; checkItems?: Array<{ name: string; state?: string; pos?: number }> }>
}

/** A Trello board export (the JSON a board link or "Export as JSON" gives). */
export function parseTrelloJson(text: string, fallbackName = 'Imported board'): ImportPayload {
  let j: ExportJson
  try {
    j = JSON.parse(text) as ExportJson
  } catch {
    throw new Error('That is not a board export we can read. Use the JSON export of a board, or a CSV.')
  }
  return fromTrelloObject(j, fallbackName)
}

export function fromTrelloObject(j: ExportJson, fallbackName = 'Imported board'): ImportPayload {
  if (!j || !Array.isArray(j.lists) || !Array.isArray(j.cards)) throw new Error('That JSON has no lists and cards in it.')
  const checks = new Map<string, Array<{ text: string; done: boolean }>>()
  for (const cl of [...(j.checklists ?? [])].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))) {
    const arr = checks.get(cl.idCard) ?? []
    for (const it of [...(cl.checkItems ?? [])].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))) arr.push({ text: it.name, done: it.state === 'complete' })
    checks.set(cl.idCard, arr)
  }
  const lists = j.lists
    .filter((l) => !l.closed)
    .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
    .map((l) => ({
      title: l.name,
      cards: (j.cards ?? [])
        .filter((c) => c.idList === l.id && !c.closed)
        .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
        .map((c) => ({
          title: c.name,
          notes: c.desc || null,
          due: c.due ? isoDate(c.due) : null,
          done: !!c.dueComplete,
          tags: (c.labels ?? []).map((x) => (x.name || '').trim()).filter(Boolean),
          checklist: checks.get(c.id) ?? [],
        })),
    }))
  return { name: j.name || fallbackName, source: 'json', lists }
}

/** Minimal RFC 4180 reader (quotes, separators and newlines inside quotes). */
export function delimitedRows(text: string, sep = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"' && cell === '') q = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

function isoDate(v: string): string | null {
  const s = v.trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

const HEAD = {
  list: ['list', 'column', 'status', 'stage', 'list name', 'section'],
  title: ['title', 'card', 'name', 'card name', 'task', 'task name', 'item'],
  notes: ['notes', 'description', 'desc', 'card description', 'details'],
  due: ['due', 'due date', 'deadline', 'date'],
  tags: ['tags', 'labels', 'label'],
}

function headerIndex(head: string[]) {
  const h = head.map((x) => x.trim().toLowerCase())
  const col = (names: string[]) => h.findIndex((x) => names.includes(x))
  return { list: col(HEAD.list), title: col(HEAD.title), notes: col(HEAD.notes), due: col(HEAD.due), tags: col(HEAD.tags) }
}

/** Spreadsheet rows with a header row (list, title, notes, due, tags). */
function fromHeaderRows(rows: string[][], name: string, source: string): ImportPayload {
  const ix = headerIndex(rows[0])
  if (ix.title < 0) throw new Error('That sheet needs a "title" (or "task") column, and ideally "list", "notes", "due".')
  const byList = new Map<string, Lists[number]>()
  for (const r of rows.slice(1)) {
    const title = (r[ix.title] ?? '').trim()
    if (!title) continue
    const listName = (ix.list >= 0 ? r[ix.list] : '')?.trim() || 'To do'
    if (!byList.has(listName)) byList.set(listName, { title: listName, cards: [] })
    byList.get(listName)!.cards.push({
      title,
      notes: ix.notes >= 0 ? r[ix.notes]?.trim() || null : null,
      due: ix.due >= 0 ? isoDate(r[ix.due] ?? '') : null,
      tags: ix.tags >= 0 ? (r[ix.tags] ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [],
    })
  }
  return { name, source, lists: Array.from(byList.values()) }
}

export function parseCsv(text: string, name: string): ImportPayload {
  const rows = delimitedRows(text.replace(/^﻿/, ''))
  if (rows.length < 2) throw new Error('That sheet has no rows. Put a header row first: list, title, notes, due.')
  return fromHeaderRows(rows, name, 'csv')
}

/** A file picked from the computer: .json (board export) or .csv. */
export function parseBoardFile(fileName: string, text: string): ImportPayload {
  if (text.length > 15_000_000) throw new Error('That file is too big to import.')
  const base = fileName.replace(/\.[^.]+$/, '') || 'Imported board'
  const looksJson = /\.json$/i.test(fileName) || /^\s*[{[]/.test(text)
  const p = looksJson ? parseTrelloJson(text, base) : parseCsv(text, base)
  if (!p.lists.length) throw new Error('Nothing to import in that file.')
  return p
}

const BULLET = /^(?:[-*•▪◦]|\d+[.)]|\[(?: |x|X)?\])\s+/
const DONE_BOX = /^(?:[-*•]\s+)?\[(x|X)\]\s+/
const OPEN_BOX = /^(?:[-*•]\s+)?\[ ?\]\s+/

/**
 * Pasted text. Two shapes:
 *  - rows copied from a spreadsheet (tab-separated). A header row (title /
 *    task, list, notes, due, tags) maps columns; without one, the first
 *    column is the card and the rest become its notes.
 *  - a plain list, one task per line. "Heading:" or "# Heading" lines start a
 *    new list; bullets and numbers are dropped; "[x]" marks a task done;
 *    indented bullets under a task become its checklist.
 */
export function parsePastedText(text: string, name = 'Pasted board'): ImportPayload {
  const raw = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (raw.length > 2_000_000) throw new Error('That is too much text to import at once.')
  const lines = raw.split('\n').filter((l) => l.trim())
  if (!lines.length) throw new Error('Paste at least one task.')

  const tabbed = lines.filter((l) => /\S\t/.test(l)).length
  if (tabbed >= Math.max(1, Math.ceil(lines.length / 2))) {
    const rows = delimitedRows(raw, '\t')
    const ix = headerIndex(rows[0])
    if (ix.title >= 0 && rows.length > 1) return { ...fromHeaderRows(rows, name, 'paste'), source: 'paste' }
    const cards: Card[] = rows
      .map((r) => ({ title: (r[0] ?? '').trim(), notes: r.slice(1).map((c) => c.trim()).filter(Boolean).join(' · ') || null }))
      .filter((c) => c.title)
    return { name, source: 'paste', lists: [{ title: 'To do', cards }] }
  }

  const lists: Lists = []
  let current: Lists[number] | null = null
  let lastCard: Card | null = null
  const ensure = () => {
    if (!current) {
      current = { title: 'To do', cards: [] }
      lists.push(current)
    }
    return current
  }
  for (const line of lines) {
    const indented = /^(?:\t| {2,})\S/.test(line)
    const t = line.trim()
    const heading = t.match(/^#{1,6}\s+(.+)$/)?.[1] ?? (t.endsWith(':') && !BULLET.test(t) && t.length <= 80 ? t.slice(0, -1) : null)
    if (heading && !indented) {
      current = { title: heading.trim(), cards: [] }
      lists.push(current)
      lastCard = null
      continue
    }
    const done = DONE_BOX.test(t)
    const body = t.replace(DONE_BOX, '').replace(OPEN_BOX, '').replace(BULLET, '').trim()
    if (!body) continue
    if (indented && lastCard) {
      lastCard.checklist = [...(lastCard.checklist ?? []), { text: body, done }]
      continue
    }
    const card: Card = { title: body, done, checklist: [] }
    ensure().cards.push(card)
    lastCard = card
  }
  const kept = lists.filter((l) => l.cards.length)
  if (!kept.length) throw new Error('Paste at least one task.')
  return { name, source: 'paste', lists: kept }
}

/** "3 lists, 41 cards" for the preview. */
export function importCounts(p: ImportPayload): { lists: number; cards: number; checklist: number } {
  let cards = 0
  let checklist = 0
  for (const l of p.lists) {
    cards += l.cards.length
    for (const c of l.cards) checklist += c.checklist?.length ?? 0
  }
  return { lists: p.lists.length, cards, checklist }
}
