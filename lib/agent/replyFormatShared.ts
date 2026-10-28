/**
 * THE REPLY FORMATTER for Ciao: the step between "the answer is written and
 * checked" and "the answer is shown" (Nick 2026-10-26).
 *
 * "Format ados, mira, ciao replies in a more conversational way, or in a better
 * visual way like a chart... instead of jamming a bunch of stats into a message
 * of text. We need multiple formats for replying." Same design as crmbuilds
 * shared/mira/reply-format.ts (PR #4238), adapted to Ciao's tool results.
 *
 * The step picks ONE layout from a fixed menu (REPLY_FORMATS) and fills it:
 *
 *   plain    one or two conversational sentences, nothing drawn
 *   numbers  2-4 headline figures as tiles
 *   table    rows x columns, for a list of items with the same figures
 *   bar      one measure compared across items
 *   line     one measure over time
 *   split    parts of a whole
 *   steps    numbered how-to steps or a checklist
 *   callout  a one-line verdict (good / watch / bad) above the rest
 *   mixed    a line, one or two visuals, a next-step line
 *
 * Two producers, one set of wire shapes:
 *   1. CODE builds cards from what the turn's tools returned (dataCards). The
 *      chat already renders markdown tables and lists, so nothing is lifted out
 *      of the prose on the way (structureProse is kept for other surfaces).
 *   2. A MODEL pass (lib/agent/replyFormatter.ts) chooses the layout, picks
 *      which code cards to show, may draw a small visual from figures the
 *      answer already says, and rewrites the words to sound like a person.
 *
 * THE RULE THAT MAKES (2) SAFE: every figure in what it returns must already be
 * in the answer or in the data the turn read (figuresAllowed / unknownFigures).
 * One figure that is not, a dropped correction, a model or provider name, junk
 * or no words, and the whole layout is thrown away: the answer is shown as it
 * was written. The formatter changes how an answer looks; never what it says.
 *
 * React-free and DOM-free: the server step, the chat UI and the tests share it.
 */

// ── the menu ───────────────────────────────────────────────────────────────

export const REPLY_FORMATS = ['plain', 'numbers', 'table', 'bar', 'line', 'split', 'steps', 'callout', 'mixed'] as const
export type ReplyFormat = (typeof REPLY_FORMATS)[number]

/** When to use each format, said once for the prompt and the tests. */
export const REPLY_FORMAT_GUIDE: Record<Exclude<ReplyFormat, 'mixed'>, string> = {
  plain: 'a yes/no, a how-to in one breath, one number, a definition, small talk. Just say it.',
  numbers: '2-4 headline figures about ONE thing (premium written, deposits, policies, meetings this week).',
  table: '3+ items that each have the same 2-3 figures (producers with premium, policies, average).',
  bar: 'one figure compared across 2-8 items (premium by producer, meetings by person).',
  line: 'one figure over 4+ days, weeks or months (deposits per week, premium per month).',
  split: 'parts that add up to a whole (policies by carrier, time by kind of meeting).',
  steps: '3+ things to do in order, or a checklist.',
  callout: 'a verdict the reader must not miss (a number slipped, a sync failed, a deadline is today).',
}

// ── wire shapes ────────────────────────────────────────────────────────────

export type Tone = 'good' | 'bad' | 'watch' | 'neutral'

/** `window`: the time span the figure covers ("today", "7 days"). A reply once set "Leads 0" beside
 *  "Leads 2" with nothing saying which was today (Nick 2026-10-28): every tile names its window, or the
 *  card heading names the one window they all share. */
export type NumbersTile = { label: string; value: string; hint?: string; tone?: Tone; window?: string }
export type NumbersBlockWire = { type: 'numbers'; tiles: NumbersTile[]; caption?: string; heading?: string }

export type TableBlockWire = {
  type: 'table'
  heading?: string
  columns: string[]
  /** Which columns are figures (drawn right-aligned, tabular). */
  numeric: boolean[]
  rows: { cells: string[]; tone?: Tone }[]
  caption?: string
  /** Rows that exist but are not drawn ("+3 more"). */
  more?: number
}

export type ChartPoint = { label: string; value: number; display: string; tone?: Tone }

export type ChartBlockWire = {
  type: 'chart'
  kind: 'bar' | 'line' | 'split'
  heading?: string
  caption?: string
  points: ChartPoint[]
}

export type StepsBlockWire = { type: 'steps'; heading?: string; items: string[] }

export type CalloutBlockWire = { type: 'callout'; tone: Tone; text: string }

export type FormatBlockWire = NumbersBlockWire | TableBlockWire | ChartBlockWire | StepsBlockWire | CalloutBlockWire

/** What the chat draws, stored with the answer (agent_history.reply_format). */
export type ReplyFormatPayload = {
  v: 1
  format: ReplyFormat
  /** Conversational words above the visuals. */
  say: string
  blocks: FormatBlockWire[]
  /** One short line under the visuals, or "". */
  after: string
}

/** Name column + at most 3 figure columns (Shopify / Unify table pattern). */
export const TABLE_MAX_COLS = 4
export const TABLE_MAX_ROWS = 12
export const CHART_MAX_POINTS = 31
export const STEPS_MAX = 8
export const TILES_MAX = 4

// ── normalisers (never throw; null = nothing drawable) ─────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const s = (v: unknown, max = 80): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}
const toneOf = (v: unknown): Tone | undefined => (v === 'good' || v === 'bad' || v === 'watch' || v === 'neutral' ? v : undefined)
const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/[$,%\s]/g, '')) : NaN
  return Number.isFinite(n) ? n : null
}

export function normalizeNumbersBlock(input: unknown): NumbersBlockWire | null {
  if (!isObj(input)) return null
  const tiles: NumbersTile[] = []
  for (const t of Array.isArray(input.tiles) ? input.tiles : []) {
    if (!isObj(t)) continue
    const split = splitTileWindow({ label: s(t.label, 40) ?? '', window: s(t.window, 20) })
    const label = split.label
    const value = s(t.value, 32)
    if (!label || !value) continue
    const tile: NumbersTile = { label, value }
    if (split.window) tile.window = split.window
    const hint = s(t.hint, 60)
    if (hint) tile.hint = hint
    const tone = toneOf(t.tone)
    if (tone) tile.tone = tone
    tiles.push(tile)
    if (tiles.length >= TILES_MAX) break
  }
  if (tiles.length < 2) return null
  const out: NumbersBlockWire = { type: 'numbers', tiles }
  const caption = s(input.caption, 160)
  if (caption) out.caption = caption
  const heading = s(input.heading, 60)
  if (heading) out.heading = heading
  return out
}

/** Bracketed words that name a time span, not a unit ("7 days", "today", "MTD", "this week"). */
const WINDOW_WORDS = /^(today|yesterday|mtd|ytd|qtd|wtd|all time|lifetime|(this|last) (week|month|quarter|year)|((last|past) )?\d+\s*(d|days?|h|hrs?|hours?|wks?|weeks?|mos?|months?))$/i

/** "Leads (7 days)" -> label "Leads", window "7 days". Units ("Cost (USD)") stay in the label; an explicit window wins. */
export function splitTileWindow(t: { label: string; window?: string | null }): { label: string; window?: string } {
  if (t.window) return { label: t.label, window: t.window }
  const m = /^(.*\S)\s*\(([^()]{1,20})\)$/.exec(t.label)
  if (m && WINDOW_WORDS.test(m[2].trim())) return { label: m[1], window: m[2].trim() }
  return { label: t.label }
}

/** The one window every tile shares (case-insensitive), or null when they differ or a tile has none. */
export function sharedTileWindow(tiles: { label: string; window?: string }[]): string | null {
  const ws = tiles.map((t) => splitTileWindow(t).window?.toLowerCase() ?? '')
  if (!ws.length || ws.some((w) => !w) || new Set(ws).size !== 1) return null
  return ws[0]
}

export function normalizeTableBlock(input: unknown): TableBlockWire | null {
  if (!isObj(input)) return null
  const columns = (Array.isArray(input.columns) ? input.columns : []).map((c) => s(c, 40) ?? '').slice(0, TABLE_MAX_COLS)
  if (columns.length < 2 || columns.every((c) => !c)) return null
  const rows: TableBlockWire['rows'] = []
  for (const raw of Array.isArray(input.rows) ? input.rows : []) {
    const cellsIn = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.cells) ? raw.cells : null
    if (!cellsIn) continue
    const cells = columns.map((_, i) => s(cellsIn[i], 60) ?? '')
    if (cells.every((c) => !c)) continue
    const row: TableBlockWire['rows'][number] = { cells }
    const t = isObj(raw) ? toneOf(raw.tone) : undefined
    if (t) row.tone = t
    rows.push(row)
    if (rows.length >= TABLE_MAX_ROWS) break
  }
  if (!rows.length) return null
  const numericIn = Array.isArray(input.numeric) ? input.numeric : null
  const numeric = columns.map((_, i) => (numericIn
    ? numericIn[i] === true
    : i > 0 && rows.every((r) => !r.cells[i] || /\d/.test(r.cells[i]))))
  const out: TableBlockWire = { type: 'table', columns, numeric, rows }
  const heading = s(input.heading, 80)
  if (heading) out.heading = heading
  const caption = s(input.caption, 160)
  if (caption) out.caption = caption
  const more = finite(input.more)
  if (more && more > 0) out.more = Math.trunc(more)
  return out
}

export function normalizeChartBlock(input: unknown): ChartBlockWire | null {
  if (!isObj(input)) return null
  const kind = input.kind === 'bar' || input.kind === 'line' || input.kind === 'split' ? input.kind : null
  if (!kind) return null
  const points: ChartPoint[] = []
  for (const raw of Array.isArray(input.points) ? input.points : []) {
    if (!isObj(raw)) continue
    const label = s(raw.label, 48)
    const value = finite(raw.value)
    if (!label || value === null) continue
    const p: ChartPoint = { label, value, display: s(raw.display, 24) ?? String(value) }
    const t = toneOf(raw.tone)
    if (t) p.tone = t
    points.push(p)
    if (points.length >= CHART_MAX_POINTS) break
  }
  const min = kind === 'bar' ? 1 : 2
  if (points.length < min) return null
  if (kind === 'split' && (points.some((p) => p.value < 0) || points.every((p) => p.value === 0))) return null
  const out: ChartBlockWire = { type: 'chart', kind, points }
  const heading = s(input.heading, 80)
  if (heading) out.heading = heading
  const caption = s(input.caption, 160)
  if (caption) out.caption = caption
  return out
}

export function normalizeStepsBlock(input: unknown): StepsBlockWire | null {
  if (!isObj(input)) return null
  const items = (Array.isArray(input.items) ? input.items : [])
    // A step is kept whole: 240 chars cut Mira's live steps mid-word in crmbuilds (2026-10-26).
    .map((x) => s(x, 1200)).filter((x): x is string => !!x).slice(0, STEPS_MAX)
  if (items.length < 2) return null
  const out: StepsBlockWire = { type: 'steps', items }
  const heading = s(input.heading, 80)
  if (heading) out.heading = heading
  return out
}

export function normalizeCalloutBlock(input: unknown): CalloutBlockWire | null {
  if (!isObj(input)) return null
  const text = s(input.text, 200)
  if (!text) return null
  return { type: 'callout', tone: toneOf(input.tone) ?? 'neutral', text }
}

/** Any stored or wire block → a drawable block, or null. */
export function normalizeFormatBlock(input: unknown): FormatBlockWire | null {
  if (!isObj(input)) return null
  switch (input.type) {
    case 'numbers': return normalizeNumbersBlock(input)
    case 'table': return normalizeTableBlock(input)
    case 'chart': return normalizeChartBlock(input)
    case 'steps': return normalizeStepsBlock(input)
    case 'callout': return normalizeCalloutBlock(input)
  }
  return null
}

/**
 * A stored / returned layout → something the chat can draw, or null (draw the
 * answer as written). Old rows, a refused layout ({ format: 'as_written' }) and
 * junk all come back null.
 */
export function normalizeReplyFormat(input: unknown): ReplyFormatPayload | null {
  if (!isObj(input)) return null
  const format = (REPLY_FORMATS as readonly string[]).includes(String(input.format)) ? (input.format as ReplyFormat) : null
  if (!format) return null
  const say = typeof input.say === 'string' ? input.say.trim().slice(0, 600) : ''
  if (!say) return null
  const after = typeof input.after === 'string' ? input.after.trim().slice(0, 400) : ''
  const blocks = (Array.isArray(input.blocks) ? input.blocks : []).map(normalizeFormatBlock).filter((b): b is FormatBlockWire => !!b).slice(0, 4)
  return { v: 1, format, say, blocks, after }
}

// ── figures: what the formatter may say ────────────────────────────────────

/** Every figure written in a piece of text, as numbers ("$1,234.50" → 1234.5, "2.1%" → 2.1). */
export function figuresIn(text: string): { value: number; decimals: number; raw: string }[] {
  const out: { value: number; decimals: number; raw: string }[] = []
  const re = /\d[\d,]*(?:\.\d+)?/g
  let m: RegExpExecArray | null
  const t = String(text ?? '')
  while ((m = re.exec(t))) {
    const raw = m[0].replace(/,(?=\d{3}(\D|$))/g, '').replace(/,$/, '')
    const clean = raw.replace(/,/g, '')
    const value = Number(clean)
    if (!Number.isFinite(value)) continue
    const dot = clean.indexOf('.')
    out.push({ value, decimals: dot < 0 ? 0 : clean.length - dot - 1, raw: m[0] })
  }
  return out
}

/**
 * Every figure the turn is allowed to state: what the answer said, plus every
 * number in the data it read, in the units a person would write it (cents as
 * dollars, a 0.021 rate as 2.1%), plus the size of each list (so "3 producers"
 * is allowed when the read listed three).
 */
export function figuresAllowed(texts: readonly string[], datas: readonly unknown[]): number[] {
  const set = new Set<number>()
  for (const t of texts) for (const f of figuresIn(t)) set.add(f.value)
  let budget = 20000
  const walk = (v: unknown, key: string) => {
    if (budget-- <= 0 || v === null || v === undefined) return
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return
      set.add(Math.abs(v))
      if (/cents$/i.test(key)) set.add(Math.abs(v) / 100)
      if (/(rate|ctr|share|pct_of|conversion)/i.test(key) && Math.abs(v) <= 1.5) set.add(Math.abs(v) * 100)
      return
    }
    if (typeof v === 'string') { for (const f of figuresIn(v)) set.add(f.value); return }
    if (Array.isArray(v)) { set.add(v.length); for (const x of v) walk(x, key); return }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k)
  }
  for (const d of datas) walk(d, '')
  return [...set]
}

/**
 * Is `f` one of the allowed figures, as written? A figure matches when an
 * allowed number rounds to it at the precision it was written with ("$37.32"
 * matches 37.315). Never a looser match than that.
 */
export function figureAllowed(f: { value: number; decimals: number }, allowed: readonly number[]): boolean {
  const step = Math.pow(10, -f.decimals)
  for (const a of allowed) {
    if (a === f.value) return true
    if (Math.abs(a - f.value) <= step / 2 + 1e-9) return true
  }
  return false
}

/** The figures in `text` that are NOT allowed. Empty = every figure checks out. */
export function unknownFigures(text: string, allowed: readonly number[]): string[] {
  return figuresIn(text).filter((f) => !figureAllowed(f, allowed)).map((f) => f.raw)
}

// ── code-built cards, from what the tools returned ─────────────────────────

export type CodeCard = {
  /** What the formatter names it by. */
  id: string
  /** One line for the formatter: what this card shows. */
  about: string
  block: FormatBlockWire
}

/** One tool result as the turn read it: the tool's name and its parsed JSON (or text). */
export type ReadResult = { tool: string; data: unknown }

const usd = (c: unknown) => {
  const n = Number(c) / 100
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const pct1 = (r: unknown) => `${(Number(r) * 100).toFixed(1)}%`
const shortDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
  if (!m) return String(iso ?? '')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`
}
/** Columns never drawn from raw rows: ids, contact details, secrets, links. */
const HIDDEN_KEY = /(^|_)(id|uuid|email|phone|token|secret|password|key|url|href|link|ssn|dob)s?$/i
const head = (k: string) => k.replace(/_cents$/i, '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const cellOf = (k: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '–'
  if (/_cents$/i.test(k) && Number.isFinite(Number(v))) return usd(v)
  if (/(rate|ctr)$/i.test(k) && Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 1.5) return pct1(v)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return shortDate(v.slice(0, 10))
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : String(Math.round(v * 100) / 100)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v).slice(0, 60)
}
const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

/** A generic rows → table. Money columns in cents are shown as dollars; ids and contact details are never drawn. */
export function tableFromRows(rows: unknown[], heading?: string): TableBlockWire | null {
  const objs = rows.filter(isObj) as Record<string, unknown>[]
  if (objs.length < 2) return null
  const keys = Object.keys(objs[0]).filter((k) => !HIDDEN_KEY.test(k) && scalar(objs[0][k])).slice(0, TABLE_MAX_COLS)
  if (keys.length < 2) return null
  const t = normalizeTableBlock({
    type: 'table', columns: keys.map(head), heading,
    rows: objs.slice(0, 10).map((o) => keys.map((k) => cellOf(k, o[k]))),
  })
  if (t && objs.length > 10) t.more = objs.length - 10
  return t
}

/** A flat object with 2-4 figures → number tiles ({ premium_written: 48200, policies: 31 }). */
function tilesFromObject(o: Record<string, unknown>): NumbersBlockWire | null {
  const figs = Object.entries(o).filter(([k, v]) => typeof v === 'number' && Number.isFinite(v) && !HIDDEN_KEY.test(k))
  if (figs.length < 2 || figs.length > 6) return null
  return normalizeNumbersBlock({ tiles: figs.slice(0, TILES_MAX).map(([k, v]) => ({ label: head(k), value: cellOf(k, v) })) })
}

const safeId = (t: string) => t.replace(/[^a-z0-9_]+/gi, '_').slice(0, 40)

/**
 * The cards a turn's reads can be drawn as. Built from the tool results only
 * (what the answer step already read for this person, so the scope is
 * theirs); the formatter picks among them by id. At most 6.
 */
export function dataCards(reads: readonly ReadResult[]): CodeCard[] {
  const cards: CodeCard[] = []
  const push = (id: string, about: string, block: FormatBlockWire | null) => {
    if (!block || cards.some((c) => c.id === id)) return
    cards.push({ id, about, block })
  }
  try {
    for (const r of reads) {
      const d = r.data
      const tool = safeId(r.tool || 'read')
      if (Array.isArray(d)) {
        const t = tableFromRows(d)
        if (t) push(`${tool}_rows`, `table: ${d.length} rows from ${r.tool} (${t.columns.join(', ')})`, t)
        continue
      }
      if (!isObj(d)) continue
      const tiles = tilesFromObject(d)
      if (tiles) push(`${tool}_figures`, `number tiles: ${tiles.tiles.map((x) => `${x.label} ${x.value}`).join(', ')}`, tiles)
      for (const [k, v] of Object.entries(d)) {
        if (Array.isArray(v)) {
          const t = tableFromRows(v, head(k))
          if (t) push(`${tool}_${safeId(k)}`, `table: ${v.length} ${head(k).toLowerCase()} (${t.columns.join(', ')})`, t)
        } else if (isObj(v)) {
          const sub = tilesFromObject(v)
          if (sub) push(`${tool}_${safeId(k)}`, `number tiles: ${head(k).toLowerCase()} (${sub.tiles.map((x) => `${x.label} ${x.value}`).join(', ')})`, sub)
        }
      }
      if (cards.length >= 6) break
    }
  } catch {
    return cards.slice(0, 6)
  }
  return cards.slice(0, 6)
}

// ── prose → structure, with no model (kept for surfaces without markdown) ──

/**
 * Lift what is already structured in an answer out of the paragraph: a
 * markdown table becomes a table card, a numbered or bulleted list of 3+ items
 * becomes a steps card. Every word is kept; only where it is drawn changes.
 * The Ciao chat renders markdown already, so its pipeline does not call this.
 */
export function structureProse(text: string): { blocks: FormatBlockWire[]; text: string } {
  const lines = String(text ?? '').split('\n')
  const blocks: FormatBlockWire[] = []
  const keep: string[] = []
  let i = 0
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
  const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
  const cellsOf = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\*\*/g, ''))
  const listRe = /^\s*(?:\d{1,2}[.)]|[-*•])\s+(.+)$/
  while (i < lines.length) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = cellsOf(lines[i])
      const body: string[][] = []
      let j = i + 2
      while (j < lines.length && isRow(lines[j])) { body.push(cellsOf(lines[j])); j++ }
      const t = normalizeTableBlock({ type: 'table', columns: header, rows: body })
      if (t) { blocks.push(t); i = j; continue }
    }
    if (listRe.test(lines[i])) {
      const items: string[] = []
      let j = i
      while (j < lines.length && listRe.test(lines[j])) { items.push(lines[j].match(listRe)![1].trim()); j++ }
      if (items.length >= 3) {
        const st = normalizeStepsBlock({ items })
        if (st) {
          const prev = keep.length ? keep[keep.length - 1].trim() : ''
          if (prev && prev.length <= 80 && /:$/.test(prev)) { st.heading = prev.replace(/:$/, ''); keep.pop() }
          blocks.push(st); i = j; continue
        }
      }
    }
    keep.push(lines[i])
    i++
  }
  if (!blocks.length) return { blocks, text }
  return { blocks, text: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
}

// ── the model pass: its contract ───────────────────────────────────────────

/** Should the model pass run on this answer? A short, figure-light answer is already the right shape. */
export function wantsModelFormat(draft: string, cards: readonly CodeCard[]): boolean {
  const t = String(draft ?? '').trim()
  if (!t) return false
  const figs = figuresIn(t).length
  if (cards.length && figs >= 2) return true
  if (figs >= 4) return true
  if (t.length >= 320) return true
  return false
}

export function formatterSystemPrompt(assistantName: string): string {
  return [
    `You are the reply formatter for ${assistantName}, a company assistant. The answer below is already written and checked.`,
    'Your only job is to decide how it is SHOWN, and to make the words sound like a sharp colleague talking, not a report.',
    '',
    'Pick ONE format from this menu:',
    ...Object.entries(REPLY_FORMAT_GUIDE).map(([k, v]) => `- ${k}: ${v}`),
    '- mixed: one short line, then one or two visuals (cards or your own), then one short next-step line.',
    '',
    'HARD RULES:',
    '1. Never add a fact. Every figure you write (in words, tiles, tables or charts) must already be in the ANSWER or in an offered card. Copy figures exactly as written.',
    '2. Never drop a correction, warning or caveat the answer makes ("31 policies, not 34", "QuickBooks did not answer", "your calendar is not connected").',
    '3. Prefer an OFFERED CARD over building your own visual: cards are drawn from the real data. Build your own visual only from figures in the answer.',
    '4. Words: "say" is ONE or TWO short sentences that answer the question directly, the way a person would say it out loud. "after" is optional: one short line with the next step or the takeaway. Do not repeat figures a visual already shows, and do not repeat steps a steps visual lists (then "say" is one short intro line).',
    '4b. Keep the evidence. Figures the answer gives as the REASON for its advice must stay on screen: in a card (prefer an offered card that holds them) or in the words.',
    '5. No markdown, no headings, no bullet characters in the words. No "Here is a table".',
    '6. Never say you did something (sent, booked, changed). You only format.',
    `7. Speak only as ${assistantName}. Never name an AI model, a model maker or an AI provider.`,
    '8. If the answer is short and has at most one figure, choose plain and return it nearly as is.',
    '9. Decide quickly. Do not deliberate; this is a layout choice, not an analysis.',
    '10. Every number tile names its time window when the answer gives one ("window":"today" or "7 days"). Two tiles with the same label and different windows MUST each carry their window. When all tiles share one window, put it in the numbers "title" instead.',
    '',
    'Return ONLY this JSON, nothing else:',
    '{"format":"<one of the menu>","say":"...","cards":["<offered card id>"],"visuals":[<0-2 of your own>],"after":"..."}',
    'Your own visuals, each one of:',
    '{"kind":"numbers","title":"optional shared window, e.g. This week","tiles":[{"label":"Premium","value":"$48,200","hint":"optional","window":"optional, e.g. 7 days"}]}',
    '{"kind":"table","columns":["Producer","Premium","Policies"],"rows":[["Dana Reyes","$12,400","9"]]}',
    '{"kind":"bar","title":"...","items":[{"label":"...","value":12400,"display":"$12,400"}]}',
    '{"kind":"line","title":"...","items":[{"label":"Oct 12","value":5,"display":"5"}]}',
    '{"kind":"split","title":"...","items":[{"label":"...","value":2,"display":"2"}]}',
    '{"kind":"steps","items":["...","..."]}',
    '{"kind":"callout","tone":"good|watch|bad|neutral","text":"..."}',
  ].join('\n')
}

export function formatterUserMessage(input: { question: string; answer: string; cards: readonly CodeCard[] }): string {
  const cards = input.cards.length ? input.cards.map((c) => `- ${c.id}: ${c.about}`).join('\n') : '(none)'
  return [
    `QUESTION: ${String(input.question ?? '').slice(0, 600)}`,
    '',
    'ANSWER (correct, keep its meaning):',
    String(input.answer ?? '').slice(0, 4000),
    '',
    'OFFERED CARDS (drawn by code from the real data):',
    cards,
  ].join('\n')
}

export type FormatterResult = ReplyFormatPayload & {
  /** Ids of the code cards used. */
  cardsUsed: string[]
}

function parseJsonLoose(text: string): unknown {
  const t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(t.slice(a, b + 1)) } catch { return null }
}

const stripMarkdown = (t: string) => t.replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').replace(/^\s*[-*•]\s+/gm, '').trim()

/** One of the model's own visuals → a block, or null. */
function ownVisual(v: unknown): FormatBlockWire | null {
  if (!isObj(v)) return null
  const items = Array.isArray(v.items) ? v.items : []
  switch (v.kind) {
    case 'numbers': return normalizeNumbersBlock({ tiles: v.tiles, heading: v.title })
    case 'table': return normalizeTableBlock({ columns: v.columns, rows: v.rows, heading: v.title })
    case 'bar': case 'line': case 'split':
      return normalizeChartBlock({ kind: v.kind, heading: v.title, points: items.map((p: unknown) => (isObj(p) ? { label: p.label, value: p.value, display: p.display ?? p.value } : null)) })
    case 'steps': return normalizeStepsBlock({ items: items.map((x: unknown) => (typeof x === 'string' ? stripMarkdown(x) : x)), heading: v.title })
    case 'callout': return normalizeCalloutBlock({ text: typeof v.text === 'string' ? stripMarkdown(v.text) : v.text, tone: v.tone })
  }
  return null
}

/** Every string a block will draw, for the figure check. */
export function blockStrings(b: unknown): string[] {
  const out: string[] = []
  const walk = (v: unknown, key: string) => {
    if (typeof v === 'string') { if (key !== 'type' && key !== 'kind' && key !== 'tone') out.push(v); return }
    if (typeof v === 'number') { if (key === 'value' || key === 'n' || key === 'max' || key === 'v') return; out.push(String(v)); return }
    if (Array.isArray(v)) { for (const x of v) walk(x, key); return }
    if (isObj(v)) for (const [k, x] of Object.entries(v)) { if (k === 'numeric' || k === 'pct') continue; walk(x, k) }
  }
  walk(b, '')
  return out
}

/**
 * The model's reply → a checked layout, or a reason it was refused. Refused
 * means the caller shows the answer as written; there is no partial accept,
 * because a layout with one wrong figure removed still rests on it.
 *
 * `nameLeaks` (optional) returns the model / provider names in a string that
 * the question or data did not bring up (answerCheck.modelLeaks); any hit
 * refuses the layout.
 */
export function acceptFormatter(
  modelText: string,
  input: { answer: string; cards: readonly CodeCard[]; datas: readonly unknown[]; nameLeaks?: (text: string) => string[] },
): { ok: true; result: FormatterResult } | { ok: false; reason: string } {
  const j = parseJsonLoose(modelText)
  if (!isObj(j)) return { ok: false, reason: 'not_json' }
  const format = (REPLY_FORMATS as readonly string[]).includes(String(j.format)) ? (j.format as ReplyFormat) : null
  if (!format) return { ok: false, reason: 'bad_format' }
  const say = typeof j.say === 'string' ? stripMarkdown(j.say) : ''
  const after = typeof j.after === 'string' ? stripMarkdown(j.after) : ''
  if (!say) return { ok: false, reason: 'no_words' }
  // Too long is refused, never cut: a clipped sentence drops words the answer said.
  if (say.length > 600 || after.length > 400) return { ok: false, reason: 'too_long' }
  const byId = new Map(input.cards.map((c) => [c.id, c]))
  const cardsUsed = [...new Set((Array.isArray(j.cards) ? j.cards : []).map(String))].filter((id) => byId.has(id)).slice(0, 3)
  const blocks: FormatBlockWire[] = cardsUsed.map((id) => byId.get(id)!.block)
  for (const v of (Array.isArray(j.visuals) ? j.visuals : []).slice(0, 2)) {
    const b = ownVisual(v)
    if (b) blocks.push(b)
  }
  // A callout goes first whatever order it came in: it is the verdict.
  blocks.sort((a, b) => (a.type === 'callout' ? -1 : 0) - (b.type === 'callout' ? -1 : 0))
  // THE CHECK. Code cards are built from the data; the model's own words and
  // visuals may only state what the answer or those cards already state.
  const allowed = figuresAllowed([input.answer, ...input.cards.map((c) => blockStrings(c.block).join(' '))], input.datas)
  const own = [say, after, ...blocks.filter((b) => !input.cards.some((c) => c.block === b)).flatMap(blockStrings)]
  const bad = own.flatMap((t) => unknownFigures(t, allowed))
  if (bad.length) return { ok: false, reason: `unknown_figures:${bad.slice(0, 5).join(',')}` }
  // Corrections the answer makes must survive ("31 policies, not 34").
  const correction = /\b(\d[\d,.]*)\s+\w+,?\s+not\s+(\d[\d,.]*)\b/i.exec(input.answer)
  if (correction && !new RegExp(`\\bnot\\s+${correction[2].replace(/[.]/g, '\\.')}\\b`, 'i').test(`${say} ${after}`)) {
    return { ok: false, reason: 'dropped_correction' }
  }
  // Ciao speaks only as itself.
  if (input.nameLeaks && own.some((t) => input.nameLeaks!(t).length)) return { ok: false, reason: 'model_name' }
  const outFormat: ReplyFormat = format === 'plain' && blocks.length ? 'mixed' : format
  return { ok: true, result: { v: 1, format: outFormat, say, blocks, after, cardsUsed } }
}
