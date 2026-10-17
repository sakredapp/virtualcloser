/**
 * Company decision log (Suite CXO, Ciao): the pure half. No database, no
 * model, no clock of its own, so the rules are pinned by tests.
 *
 *  - decisionsFromDigest: the decisions on one meeting's digest
 *    (plaud_notes.mira_digest), with who made the call when Ciao heard it.
 *  - findReversal: is a later decision the opposite of an earlier one? Kept
 *    conservative on purpose: the two must clearly be about the same thing
 *    (at least two shared topic words, most of the shorter one), and then
 *    one of three plain contradictions must hold:
 *      1. one says do it and the other says don't (not, stop, cancel, drop…);
 *      2. opposite verbs (raise / lower, add / remove, open / close…);
 *      3. the same thing with a different value (November → December,
 *         Friday → Monday, Q4 → Q1, 3 → 5, weekly → monthly).
 *    A plain repeat (same words, same direction, same value) is never a
 *    reversal.
 *  - The in-app notice to the executives when a reversal lands.
 */

export const DECISION_KEY_PREFIX = 'decision-reversed-'
/** Only reversals decided this recently are told to anyone (a backfill of old meetings stays quiet). */
export const NOTIFY_WITHIN_DAYS = 14
/** Earlier decisions further back than this are not compared. */
export const LOOKBACK_DAYS = 365
export const MIN_SHARED_WORDS = 2
export const MIN_SHARED_SHARE = 0.6

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase()
const oneLine = (s: string, max: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

// ── Reading a digest ────────────────────────────────────────────────────────

export type DigestDecision = { idx: number; text: string; by: string | null }

const cleanBy = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, 120) : ''
  return s && !/^(null|none|unknown|n\/a|nobody|everyone|we|the team|team)$/i.test(s) ? s : null
}

/**
 * Decisions on a digest, in order. `decisions` is the list every reader uses
 * (strings); `decided` (newer digests) carries who made each call.
 */
export function decisionsFromDigest(d: { decisions?: unknown; decided?: unknown } | null | undefined): DigestDecision[] {
  if (!d) return []
  const list = Array.isArray(d.decisions) ? d.decisions : []
  const decided = Array.isArray(d.decided) ? (d.decided as unknown[]) : []
  const byText = new Map<string, string | null>()
  for (const x of decided) {
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      byText.set(lower(o.text), cleanBy(o.by))
    }
  }
  const out: DigestDecision[] = []
  list.forEach((x, idx) => {
    const raw = typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as { text?: unknown }).text ?? '') : ''
    const text = oneLine(raw, 600)
    if (text.length < 3) return
    const by = x && typeof x === 'object' ? cleanBy((x as { by?: unknown }).by) : (byText.get(lower(text)) ?? null)
    out.push({ idx, text, by })
  })
  return out
}

/** The model's decisions, which may come back as strings or {text, by}. */
export function asDecided(v: unknown, max = 8): Array<{ text: string; by: string | null }> {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => {
      if (typeof x === 'string') return { text: x.trim().slice(0, 400), by: null }
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>
        return { text: String(o.text ?? '').trim().slice(0, 400), by: cleanBy(o.by) }
      }
      return { text: '', by: null }
    })
    .filter((x) => x.text.length > 2)
    .slice(0, max)
}

// ── Words ───────────────────────────────────────────────────────────────────

const STOP = new Set(
  ('a an the and or but of for on in at by to with from into onto as is are was were be been being it its this that these those ' +
    'we our us you your they their them he she his her i me my will would should shall can could may might must do does did done ' +
    'have has had get gets got go goes going gone make made let lets so then than there here also just only all any some each every ' +
    'more less very about over under after before until till up down out off again now today tomorrow next last this week month ' +
    'agreed agree agrees decided decide decides decision decisions approved team everyone going forward instead plan plans ' +
    'move moves moved moving change changes changed switch switched keep kept stay stays').split(/\s+/),
)

/** Words that turn a decision into "don't". */
const NEG = new Set(
  ('not no never none nor dont don t wont won cant cannot isnt arent wasnt werent shouldnt wouldnt without ' +
    'stop stops stopped stopping cancel cancels cancelled canceled cancelling canceling drop drops dropped dropping ' +
    'scrap scraps scrapped abandon abandoned shelve shelved kill killed halt halted pause paused pausing ' +
    'postpone postponed delay delayed defer deferred reject rejected decline declined against freeze frozen ' +
    'end ended ending sunset sunsetted discontinue discontinued revert reverted reverse reversed undo').split(/\s+/),
)

const ANTONYMS: Array<[string, string]> = [
  ['raise', 'lower'],
  ['raise', 'cut'],
  ['increase', 'decrease'],
  ['increase', 'reduce'],
  ['increase', 'cut'],
  ['add', 'remove'],
  ['open', 'close'],
  ['expand', 'shrink'],
  ['expand', 'reduce'],
  ['hire', 'fire'],
  ['more', 'fewer'],
  ['up', 'down'],
  ['inhouse', 'outsource'],
  ['buy', 'sell'],
  ['include', 'exclude'],
  ['allow', 'ban'],
  ['public', 'private'],
  ['online', 'offline'],
]

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_FULL = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const FREQ = new Set(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'annually', 'annual'])

/** A stem good enough to match "pilots" to "pilot" and "renewal" to "renewals". */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -1)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

/** A value word: month, weekday, quarter, frequency, number. Returned as "class:value" plus how to say it. */
function valueOf(w: string): { key: string; say: string } | null {
  let i = MONTH_FULL.indexOf(w)
  if (i < 0 && w.length === 3) i = MONTHS.indexOf(w)
  if (i < 0 && w === 'sept') i = 8
  if (i >= 0) return { key: `month:${i}`, say: MONTH_FULL[i][0].toUpperCase() + MONTH_FULL[i].slice(1) }
  let d = DAY_FULL.indexOf(w)
  if (d < 0 && w.length === 3) d = DAYS.indexOf(w)
  if (d >= 0) return { key: `day:${d}`, say: DAY_FULL[d][0].toUpperCase() + DAY_FULL[d].slice(1) }
  const q = w.match(/^q([1-4])$/)
  if (q) return { key: `quarter:${q[1]}`, say: `Q${q[1]}` }
  if (FREQ.has(w)) return { key: `freq:${w === 'annually' || w === 'annual' ? 'yearly' : w}`, say: w }
  const n = w.match(/^\$?(\d+(?:\.\d+)?)(k|m|%)?$/)
  if (n) {
    const unit = n[2] ?? ''
    const cls = unit === '%' ? 'pct' : w.startsWith('$') || unit === 'k' || unit === 'm' ? 'money' : /^(19|20)\d\d$/.test(n[1]) ? 'year' : 'num'
    const mult = unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : 1
    return { key: `${cls}:${Number(n[1]) * mult}`, say: w }
  }
  return null
}

export type DecisionWords = {
  /** Topic words (stemmed): what the decision is about. */
  topic: Set<string>
  negated: boolean
  /** Opposite-verb words present (stemmed base forms from ANTONYMS). */
  verbs: Set<string>
  /** Value words by class: "month" → {"month:10" → "November"}. */
  values: Map<string, Map<string, string>>
}

const ANTONYM_WORDS = new Set(ANTONYMS.flat())

export function decisionWords(text: string): DecisionWords {
  const raw = lower(text)
    .replace(/in-house/g, 'inhouse')
    .replace(/(\w)'(t|s|re|ll|d|ve)\b/g, '$1$2')
    .replace(/[^a-z0-9$%.\s]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/\.+$/, ''))
    .filter(Boolean)
  const out: DecisionWords = { topic: new Set(), negated: false, verbs: new Set(), values: new Map() }
  for (const w of raw) {
    if (NEG.has(w)) {
      out.negated = true
      continue
    }
    const v = valueOf(w)
    if (v) {
      const cls = v.key.split(':')[0]
      const m = out.values.get(cls) ?? new Map<string, string>()
      m.set(v.key, v.say)
      out.values.set(cls, m)
      continue
    }
    const s = stem(w)
    if (ANTONYM_WORDS.has(s) || ANTONYM_WORDS.has(w)) {
      out.verbs.add(ANTONYM_WORDS.has(s) ? s : w)
      continue
    }
    if (w.length < 3 || STOP.has(w) || STOP.has(s) || /^[\d.]+$/.test(w)) continue
    out.topic.add(s)
  }
  return out
}

/** The topic key kept on the row (sorted topic words), for display and quick matching. */
export function topicKey(text: string): string {
  return [...decisionWords(text).topic].sort().join(' ').slice(0, 600)
}

/** Same thing? At least MIN_SHARED_WORDS topic words in common, covering most of the shorter one. */
export function sameTopic(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared >= MIN_SHARED_WORDS && shared / Math.min(a.size, b.size) >= MIN_SHARED_SHARE
}

/** Why the later decision contradicts the earlier one, or null when it does not (clearly). */
export function contradiction(later: string, earlier: string): string | null {
  const a = decisionWords(later)
  const b = decisionWords(earlier)
  if (!sameTopic(a.topic, b.topic)) return null
  if (a.negated !== b.negated) return a.negated ? 'A later meeting called it off.' : 'A later meeting went ahead with it after deciding against it.'
  for (const [x, y] of ANTONYMS) {
    if ((a.verbs.has(x) && b.verbs.has(y) && !a.verbs.has(y) && !b.verbs.has(x)) || (a.verbs.has(y) && b.verbs.has(x) && !a.verbs.has(x) && !b.verbs.has(y))) {
      const now = a.verbs.has(x) ? x : y
      const was = now === x ? y : x
      return `Changed from ${was} to ${now}.`
    }
  }
  for (const [cls, av] of a.values) {
    const bv = b.values.get(cls)
    if (!bv || !av.size || !bv.size) continue
    const overlap = [...av.keys()].some((k) => bv.has(k))
    if (!overlap) return `Changed from ${[...bv.values()].join('/')} to ${[...av.values()].join('/')}.`
  }
  return null
}

export type LoggedDecision = {
  id: string
  note_id: string
  text: string
  decided_at: string
  meeting_title: string | null
}

/**
 * The earlier decision this one reverses: the most recent earlier decision
 * from another meeting, within LOOKBACK_DAYS, that it clearly contradicts.
 */
export function findReversal<D extends LoggedDecision>(later: Pick<LoggedDecision, 'id' | 'note_id' | 'text' | 'decided_at'>, earlier: D[]): { target: D; reason: string } | null {
  const t = Date.parse(later.decided_at)
  if (!Number.isFinite(t)) return null
  const from = t - LOOKBACK_DAYS * 86_400_000
  const sorted = earlier
    .filter((e) => e.id !== later.id && e.note_id !== later.note_id)
    .filter((e) => {
      const et = Date.parse(e.decided_at)
      return Number.isFinite(et) && et < t && et >= from
    })
    .sort((x, y) => y.decided_at.localeCompare(x.decided_at))
  for (const e of sorted) {
    const reason = contradiction(later.text, e.text)
    if (reason) return { target: e, reason }
  }
  return null
}

// ── The notice ──────────────────────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-10-02…" → "Oct 2". */
export function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${MON[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}` : iso
}

/** One notice per reversal per executive: the (rep_id, key) unique index is the lock. */
export function reversalNoticeKey(laterId: string, memberId: string): string {
  return `${DECISION_KEY_PREFIX}${laterId}-${memberId}`
}

export function shouldNotify(decidedAt: string, now: Date, days = NOTIFY_WITHIN_DAYS): boolean {
  const t = Date.parse(decidedAt)
  return Number.isFinite(t) && now.getTime() - t <= days * 86_400_000
}

export function reversalNoticeText(
  later: { text: string; decided_at: string; meeting_title: string | null },
  earlier: { text: string; decided_at: string; meeting_title: string | null },
  reason: string,
): { title: string; body: string } {
  const where = (d: { decided_at: string; meeting_title: string | null }) => `${d.meeting_title ? `${oneLine(d.meeting_title, 80)}, ` : ''}${shortDay(d.decided_at)}`
  return {
    title: oneLine(`Decision reversed: ${later.text}`, 300),
    body: [`- Now (${where(later)}): ${oneLine(later.text, 300)}`, `- Before (${where(earlier)}): ${oneLine(earlier.text, 300)}`, `- ${reason}`].join('\n').slice(0, 8000),
  }
}

// ── Search ──────────────────────────────────────────────────────────────────

/** How well a decision matches "what did we decide about X": shared topic words (0 = no match). */
export function matchScore(text: string, meetingTitle: string | null, query: string): number {
  const q = decisionWords(query).topic
  if (!q.size) return 1
  const words = decisionWords(`${text} ${meetingTitle ?? ''}`).topic
  let hit = 0
  for (const w of q) if (words.has(w) || [...words].some((x) => x.length >= 4 && w.length >= 4 && (x.startsWith(w) || w.startsWith(x)))) hit++
  return hit
}
