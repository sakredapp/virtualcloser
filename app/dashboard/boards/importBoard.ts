/**
 * "Import a board": read a board export (JSON, the format the common board
 * tools export) or a spreadsheet (CSV: list, title, notes, due) into one
 * payload for /api/boards. Parsed in the browser; the server only inserts.
 */
import type { ImportPayload } from '@/lib/boards'

type ExportJson = {
  name?: string
  lists?: Array<{ id: string; name: string; closed?: boolean; pos?: number }>
  cards?: Array<{ id: string; idList: string; name: string; desc?: string; due?: string | null; closed?: boolean; dueComplete?: boolean; pos?: number; labels?: Array<{ name?: string; color?: string }> }>
  checklists?: Array<{ idCard: string; checkItems?: Array<{ name: string; state?: string; pos?: number }> }>
}

function fromJson(text: string, fileName: string): ImportPayload {
  let j: ExportJson
  try {
    j = JSON.parse(text) as ExportJson
  } catch {
    throw new Error('That file is not a board export we can read. Use the JSON export of a board, or a CSV.')
  }
  if (!Array.isArray(j.lists) || !Array.isArray(j.cards)) throw new Error('That JSON has no lists and cards in it.')
  const checks = new Map<string, Array<{ text: string; done: boolean }>>()
  for (const cl of j.checklists ?? []) {
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
          due: c.due ? c.due.slice(0, 10) : null,
          done: !!c.dueComplete,
          tags: (c.labels ?? []).map((x) => x.name || '').filter(Boolean),
          checklist: checks.get(c.id) ?? [],
        })),
    }))
  return { name: j.name || fileName.replace(/\.[^.]+$/, ''), source: 'json', lists }
}

/** Minimal RFC 4180 CSV reader (quotes, commas and newlines inside quotes). */
function csvRows(text: string): string[][] {
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
    } else if (ch === '"') q = true
    else if (ch === ',') {
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

function fromCsv(text: string, fileName: string): ImportPayload {
  const rows = csvRows(text.replace(/^﻿/, ''))
  if (rows.length < 2) throw new Error('That CSV has no rows. Put a header row first: list, title, notes, due.')
  const head = rows[0].map((h) => h.trim().toLowerCase())
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h))
  const iList = col('list', 'column', 'status', 'stage', 'list name')
  const iTitle = col('title', 'card', 'name', 'card name', 'task')
  const iNotes = col('notes', 'description', 'desc', 'card description')
  const iDue = col('due', 'due date')
  const iTags = col('tags', 'labels')
  if (iTitle < 0) throw new Error('That CSV needs a "title" column (and ideally "list", "notes", "due").')
  const byList = new Map<string, ImportPayload['lists'][number]>()
  for (const r of rows.slice(1)) {
    const title = (r[iTitle] ?? '').trim()
    if (!title) continue
    const listName = (iList >= 0 ? r[iList] : '')?.trim() || 'To do'
    if (!byList.has(listName)) byList.set(listName, { title: listName, cards: [] })
    byList.get(listName)!.cards.push({
      title,
      notes: iNotes >= 0 ? r[iNotes]?.trim() || null : null,
      due: iDue >= 0 ? isoDate(r[iDue] ?? '') : null,
      tags: iTags >= 0 ? (r[iTags] ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [],
    })
  }
  return { name: fileName.replace(/\.[^.]+$/, ''), source: 'csv', lists: Array.from(byList.values()) }
}

export function parseBoardFile(fileName: string, text: string): ImportPayload {
  if (text.length > 15_000_000) throw new Error('That file is too big to import.')
  const looksJson = /\.json$/i.test(fileName) || /^\s*[{[]/.test(text)
  const p = looksJson ? fromJson(text, fileName) : fromCsv(text, fileName)
  if (!p.lists.length) throw new Error('Nothing to import in that file.')
  return p
}
