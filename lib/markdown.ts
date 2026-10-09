/**
 * A small, safe markdown reader for the text Mira and the note-taker write:
 * headings, bullets (with one level of nesting), numbered lists, to-do
 * checkboxes, quotes, rules, simple tables, and inline **bold**, *italic*,
 * `code` and https links.
 *
 * It returns plain data, never HTML. The renderer (app/components/cxo/
 * Markdown.tsx) turns it into React elements, so any <tag> in the source is
 * shown as text and nothing is ever injected. Links are http(s) only.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: Inline[] }
  | { t: 'italic'; v: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string }

export type ListItem = { text: Inline[]; depth: number; task?: 'open' | 'done' }

export type Block =
  | { t: 'heading'; level: number; text: Inline[] }
  | { t: 'para'; lines: Inline[][] }
  | { t: 'list'; ordered: boolean; items: ListItem[] }
  | { t: 'quote'; lines: Inline[][] }
  | { t: 'rule' }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

const SAFE_HREF = /^https?:\/\/[^\s<>"']+$/i

/** **bold**, __bold__, *italic*, _italic_, `code`, [label](https://…), bare https URLs. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  const re = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(?<![\w*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)([^_]+?)(?<!\s)_(?![\w_])/g
  let last = 0
  let m: RegExpExecArray | null
  const push = (v: string) => {
    if (!v) return
    const prev = out[out.length - 1]
    if (prev && prev.t === 'text') prev.v += v
    else out.push({ t: 'text', v })
  }
  while ((m = re.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index))
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] })
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ t: 'bold', v: parseInline((m[2] ?? m[3])!) })
    else if (m[4] !== undefined) {
      // A label with an unsafe target (javascript:, data:, relative) is just its label.
      if (SAFE_HREF.test(m[5]!)) out.push({ t: 'link', v: m[4], href: m[5]! })
      else push(m[4])
    } else if (m[6] !== undefined) out.push({ t: 'link', v: 'Open link', href: m[6] })
    else out.push({ t: 'italic', v: parseInline((m[7] ?? m[8])!) })
    last = m.index + m[0].length
  }
  if (last < text.length) push(text.slice(last))
  return out
}

/** The plain words of an inline run (tests, titles, aria labels). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'bold' || n.t === 'italic' ? inlineText(n.v) : n.v)).join('')
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

export function parseMarkdown(src: string): Block[] {
  const lines = (src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let quote: string[] = []
  let list: { ordered: boolean; items: ListItem[]; baseIndent: number } | null = null

  const flushPara = () => {
    if (para.length) blocks.push({ t: 'para', lines: para.map(parseInline) })
    para = []
  }
  const flushQuote = () => {
    if (quote.length) blocks.push({ t: 'quote', lines: quote.map(parseInline) })
    quote = []
  }
  const flushList = () => {
    if (list) blocks.push({ t: 'list', ordered: list.ordered, items: list.items })
    list = null
  }
  const flushAll = () => { flushPara(); flushQuote(); flushList() }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, '    ').trimEnd()
    if (!line.trim()) { flushAll(); continue }

    // Table: a | row followed by a |---| separator.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushAll()
      const head = splitRow(line).map(parseInline)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]).map(parseInline))
        i++
      }
      i--
      blocks.push({ t: 'table', head, rows })
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushAll(); blocks.push({ t: 'rule' }); continue }

    const head = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (head) {
      flushAll()
      blocks.push({ t: 'heading', level: head[1].length, text: parseInline(head[2]) })
      continue
    }

    const q = /^\s*>\s?(.*)$/.exec(line)
    if (q) {
      flushPara(); flushList()
      quote.push(q[1])
      continue
    }
    flushQuote()

    const bullet = /^(\s*)[-*+•]\s+(.*)$/.exec(line)
    const num = /^(\s*)\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || num) {
      flushPara()
      const mm = (bullet ?? num)!
      const indent = mm[1].length
      const ordered = !bullet
      // A nested bullet under a numbered item stays in the same list.
      if (!list || (indent === 0 && list.ordered !== ordered)) {
        flushList()
        list = { ordered, items: [], baseIndent: indent }
      }
      const depth = indent > list.baseIndent ? 1 : 0
      let body = mm[2]
      let task: ListItem['task']
      const box = /^\[( |x|X)\]\s+(.*)$/.exec(body)
      if (box) { task = box[1] === ' ' ? 'open' : 'done'; body = box[2] }
      list.items.push({ text: parseInline(body), depth, ...(task ? { task } : {}) })
      continue
    }

    // A wrapped line right under a list item continues that item.
    if (list && /^\s{2,}\S/.test(line)) {
      const it = list.items[list.items.length - 1]
      it.text = [...it.text, { t: 'text', v: ' ' }, ...parseInline(line.trim())]
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flushAll()
  return blocks
}
