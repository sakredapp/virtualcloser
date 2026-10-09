import { describe, expect, it } from 'vitest'
import { fromTrelloObject, importCounts, parseBoardFile, parsePastedText, parseTrelloJson } from '@/lib/boardImport'
import { allowedHost, classifyLink } from '@/lib/boardImportLink'
import { isOverdue, personSubline, type BoardPerson } from '@/lib/boardsShared'

const trello = {
  name: 'Q4 launch',
  lists: [
    { id: 'L2', name: 'Doing', pos: 2 },
    { id: 'L1', name: 'To do', pos: 1 },
    { id: 'L3', name: 'Old', pos: 3, closed: true },
  ],
  cards: [
    { id: 'c2', idList: 'L1', name: 'Second', pos: 2 },
    { id: 'c1', idList: 'L1', name: 'First', pos: 1, desc: 'notes here', due: '2026-11-03T17:00:00.000Z', labels: [{ name: 'carrier' }, { name: '' }] },
    { id: 'c3', idList: 'L2', name: 'Archived', closed: true },
    { id: 'c4', idList: 'L2', name: 'Done one', dueComplete: true },
    { id: 'c5', idList: 'L3', name: 'In a closed list' },
  ],
  checklists: [{ idCard: 'c1', checkItems: [{ name: 'b', pos: 2, state: 'complete' }, { name: 'a', pos: 1 }] }],
}

describe('Trello JSON', () => {
  it('keeps open lists and cards in Trello order, with notes, due, tags, checklist', () => {
    const p = parseTrelloJson(JSON.stringify(trello))
    expect(p.name).toBe('Q4 launch')
    expect(p.lists.map((l) => l.title)).toEqual(['To do', 'Doing'])
    expect(p.lists[0].cards.map((c) => c.title)).toEqual(['First', 'Second'])
    const first = p.lists[0].cards[0]
    expect(first.notes).toBe('notes here')
    expect(first.due).toBe('2026-11-03')
    expect(first.tags).toEqual(['carrier'])
    expect(first.checklist).toEqual([{ text: 'a', done: false }, { text: 'b', done: true }])
    expect(p.lists[1].cards).toHaveLength(1)
    expect(p.lists[1].cards[0].done).toBe(true)
    expect(importCounts(p)).toEqual({ lists: 2, cards: 3, checklist: 2 })
  })

  it('falls back to a name and rejects non-board JSON', () => {
    expect(fromTrelloObject({ lists: [], cards: [] }, 'Fallback').name).toBe('Fallback')
    expect(() => parseTrelloJson('not json')).toThrow()
    expect(() => parseTrelloJson('{"foo":1}')).toThrow()
  })

  it('parseBoardFile reads JSON and CSV', () => {
    expect(parseBoardFile('board.json', JSON.stringify(trello)).lists).toHaveLength(2)
    const csv = parseBoardFile('tasks.csv', 'list,title,notes,due\nTo do,"Call, then email",x,2026-12-01\nDone,Book venue,,\n')
    expect(csv.name).toBe('tasks')
    expect(csv.lists.map((l) => l.title)).toEqual(['To do', 'Done'])
    expect(csv.lists[0].cards[0]).toMatchObject({ title: 'Call, then email', notes: 'x', due: '2026-12-01' })
  })
})

describe('Pasted text', () => {
  it('one task per line, bullets and numbers stripped', () => {
    const p = parsePastedText('- Call the carrier\n2. Send the deck\n\n* Book venue\n')
    expect(p.source).toBe('paste')
    expect(p.lists).toHaveLength(1)
    expect(p.lists[0].title).toBe('To do')
    expect(p.lists[0].cards.map((c) => c.title)).toEqual(['Call the carrier', 'Send the deck', 'Book venue'])
  })

  it('headings start lists, [x] marks done, indented lines become a checklist', () => {
    const p = parsePastedText('# This week\n- Launch\n  - write copy\n  - [x] pick image\nDone:\n[x] Book venue\n')
    expect(p.lists.map((l) => l.title)).toEqual(['This week', 'Done'])
    expect(p.lists[0].cards[0].checklist).toEqual([
      { text: 'write copy', done: false },
      { text: 'pick image', done: true },
    ])
    expect(p.lists[1].cards[0]).toMatchObject({ title: 'Book venue', done: true })
  })

  it('tab-separated rows with a header map columns', () => {
    const p = parsePastedText('Task\tList\tDue\nCall\tTo do\t2026-12-01\nShip\tDoing\t\n')
    expect(p.lists.map((l) => l.title)).toEqual(['To do', 'Doing'])
    expect(p.lists[0].cards[0]).toMatchObject({ title: 'Call', due: '2026-12-01' })
  })

  it('tab-separated rows without a header: first column is the card, rest are notes', () => {
    const p = parsePastedText('Call Bob\tJan\tcarrier\nShip deck\tFeb\t\n')
    expect(p.lists).toHaveLength(1)
    expect(p.lists[0].cards).toEqual([
      { title: 'Call Bob', notes: 'Jan · carrier' },
      { title: 'Ship deck', notes: 'Feb' },
    ])
  })

  it('rejects empty text', () => {
    expect(() => parsePastedText('   \n\n')).toThrow()
  })
})

describe('Links', () => {
  it('classifies Trello, Sheets and other tools', () => {
    expect(classifyLink('https://trello.com/b/nC8QJJoZ/trello-development-roadmap')).toEqual({ kind: 'trello', id: 'nC8QJJoZ' })
    expect(classifyLink('trello.com/b/nC8QJJoZ')).toEqual({ kind: 'trello', id: 'nC8QJJoZ' })
    expect(classifyLink('https://trello.com/c/abc123/12-card').kind).toBe('trello-card')
    const sheet = classifyLink('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=42')
    expect(sheet).toEqual({ kind: 'sheet', fetchUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=csv&gid=42' })
    expect(classifyLink('https://app.asana.com/0/123/list')).toEqual({ kind: 'other-tool', tool: 'Asana' })
    expect(classifyLink('https://acme.monday.com/boards/1')).toEqual({ kind: 'other-tool', tool: 'Monday' })
    expect(classifyLink('https://www.notion.so/x')).toEqual({ kind: 'other-tool', tool: 'Notion' })
    expect(classifyLink('https://airtable.com/app1')).toEqual({ kind: 'other-tool', tool: 'Airtable' })
    expect(classifyLink('https://evil.example.com/b/abcdefgh').kind).toBe('unknown')
  })

  it('only allows the fixed hosts', () => {
    expect(allowedHost('trello.com')).toBe(true)
    expect(allowedHost('docs.google.com')).toBe(true)
    expect(allowedHost('doc-0s-8c-sheets.googleusercontent.com')).toBe(true)
    expect(allowedHost('trello.com.evil.com')).toBe(false)
    expect(allowedHost('169.254.169.254')).toBe(false)
    expect(allowedHost('googleusercontent.com.evil.io')).toBe(false)
  })
})

describe('People and dates', () => {
  const people: BoardPerson[] = [
    { key: 'm:1', kind: 'member', id: '1', name: 'Michael Cavaleri', email: 'mike@x.com', role: 'admin' },
    { key: 'm:2', kind: 'member', id: '2', name: 'Michael Cavaleri', email: 'spencer@x.com', role: 'owner' },
    { key: 'm:3', kind: 'member', id: '3', name: 'Lauren Christen', email: 'l@x.com', role: 'admin' },
    { key: 'p:4', kind: 'partner', id: '4', name: 'Pat Partner', email: null, org: 'Acme' },
  ]
  it('same-name people show their email; others show role or org', () => {
    expect(personSubline(people[0], people)).toBe('mike@x.com')
    expect(personSubline(people[1], people)).toBe('spencer@x.com')
    expect(personSubline(people[2], people)).toBe('Admin')
    expect(personSubline(people[3], people)).toBe('Partner · Acme')
  })
  it('overdue is strictly before today', () => {
    const today = new Date(2026, 9, 9)
    expect(isOverdue('2026-10-08', today)).toBe(true)
    expect(isOverdue('2026-10-09', today)).toBe(false)
    expect(isOverdue(null, today)).toBe(false)
  })
})
