/**
 * About you (Suite CXO): two light personal questions so Ciao leads with what
 * this person cares about. Pure: no database, so the card, the Profile pane,
 * the API, Ciao's prompt, the set_my_focus tool and the tests share one answer.
 *
 *   1. "What's your role?"  one pick (CEO / Founder, CFO, CMO, ... Other).
 *   2. "What do you want to keep an eye on?"  several chips. Insurance
 *      options when the tenant has a producer book (Pinnacle mirror or its
 *      own cxo_book_* rows), otherwise a general executive list.
 * Employees get the first question only, with a list for their kind of job.
 *
 * Stored on the person's own members.settings (merged, never replaced):
 *   ciao_role, ciao_role_other, ciao_focus (ids, most important first),
 *   ciao_about_at (answered), ciao_about_skipped_at (skipped on the card),
 *   ciao_about_asked_at (Ciao asked once in chat; never again).
 *
 * Used for: (a) which of Ciao's abilities the first-day card lists first,
 * (b) one "About this person" block in Ciao's prompt so open-ended asks lead
 * with their metrics, (c) Ciao may ask the role once in chat if unanswered.
 */

export const ABOUT_KEYS = {
  role: 'ciao_role',
  roleOther: 'ciao_role_other',
  focus: 'ciao_focus',
  answeredAt: 'ciao_about_at',
  skippedAt: 'ciao_about_skipped_at',
  askedAt: 'ciao_about_asked_at',
} as const

export type Option = { id: string; label: string }

/** Executive roles (question 1 for anyone on the executive team). */
export const EXEC_ROLES: Option[] = [
  { id: 'ceo', label: 'CEO / Founder' },
  { id: 'president', label: 'President' },
  { id: 'coo', label: 'COO' },
  { id: 'cfo', label: 'CFO' },
  { id: 'cmo', label: 'CMO' },
  { id: 'sales_head', label: 'Chief Sales / Head of Sales' },
  { id: 'recruiting_head', label: 'Head of Recruiting' },
  { id: 'vp', label: 'VP / Director' },
  { id: 'ops_admin', label: 'Operations / Admin' },
  { id: 'ea', label: 'Executive Assistant' },
  { id: 'other', label: 'Other' },
]

/** Employee roles (question 1 only, for an employee login). */
export const EMPLOYEE_ROLES: Option[] = [
  { id: 'sales', label: 'Sales' },
  { id: 'support', label: 'Customer or agent support' },
  { id: 'ops_admin', label: 'Operations / Admin' },
  { id: 'recruiting', label: 'Recruiting / Onboarding' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'finance', label: 'Finance / Commissions' },
  { id: 'ea', label: 'Executive Assistant' },
  { id: 'other', label: 'Other' },
]

/** What an insurance executive keeps an eye on (tenant has a producer book). */
export const INSURANCE_FOCUS: Option[] = [
  { id: 'submitted_ap', label: 'Submitted AP & production' },
  { id: 'placement', label: 'Issued & placement rate' },
  { id: 'retention', label: 'Agent retention & drifting agents' },
  { id: 'recruiting', label: 'New agents & recruiting' },
  { id: 'top_slipping', label: 'Top & slipping agents' },
  { id: 'agencies', label: 'Agency & downline performance' },
  { id: 'carriers', label: 'Carrier mix' },
  { id: 'persistency', label: 'Persistency & lapses' },
  { id: 'revenue', label: 'Revenue & commissions' },
  { id: 'cash', label: 'Cash & expenses' },
  { id: 'followups', label: 'Team follow-ups & accountability' },
  { id: 'calendar', label: 'My calendar & meeting prep' },
  { id: 'board', label: 'Board & investor updates' },
  { id: 'hiring', label: 'Hiring & HR' },
]

/** What any other executive keeps an eye on. */
export const GENERAL_FOCUS: Option[] = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'cash', label: 'Cash & expenses' },
  { id: 'team', label: 'Team performance & quotas' },
  { id: 'hiring', label: 'Hiring & HR' },
  { id: 'churn', label: 'Customer churn & retention' },
  // No 'pipeline' focus: Suite CXO has no sales tools (owner 2026-10-20).
  { id: 'marketing', label: 'Marketing results' },
  { id: 'ops', label: 'Operations & projects' },
  { id: 'followups', label: 'Team follow-ups & accountability' },
  { id: 'calendar', label: 'My calendar & meeting prep' },
  { id: 'board', label: 'Board & investor updates' },
  { id: 'partners', label: 'Partners & vendors' },
  { id: 'approvals', label: 'Approvals waiting on me' },
]

export type Flavor = { insurance: boolean; quickbooks: boolean }
export type Audience = 'exec' | 'employee'

export const ROLE_OTHER_MAX = 60
export const FOCUS_MAX = 6

/** The role list this person picks from. */
export const rolesFor = (who: Audience): Option[] => (who === 'employee' ? EMPLOYEE_ROLES : EXEC_ROLES)

/** The chips this person picks from. Employees get none. Cash only with QuickBooks on an insurance book. */
export function focusOptionsFor(who: Audience, f: Flavor): Option[] {
  if (who === 'employee') return []
  if (!f.insurance) return GENERAL_FOCUS
  return f.quickbooks ? INSURANCE_FOCUS : INSURANCE_FOCUS.filter((o) => o.id !== 'cash')
}

export type About = {
  role: string | null
  roleOther: string | null
  focus: string[]
  answered: boolean
  skipped: boolean
  asked: boolean
  /** A title someone typed earlier (members.settings.title), used only when they have not picked a role. */
  storedTitle: string | null
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max)
  return t || null
}

/** What they told us, from their members.settings. */
export function readAbout(settings: Record<string, unknown> | null | undefined): About {
  const s = settings ?? {}
  const role = str(s[ABOUT_KEYS.role], 40)
  const focusRaw = Array.isArray(s[ABOUT_KEYS.focus]) ? (s[ABOUT_KEYS.focus] as unknown[]) : []
  const focus = [...new Set(focusRaw.filter((x): x is string => typeof x === 'string' && x.length <= 40))].slice(0, FOCUS_MAX)
  return {
    role,
    roleOther: role === 'other' ? str(s[ABOUT_KEYS.roleOther], ROLE_OTHER_MAX) : null,
    focus,
    answered: !!s[ABOUT_KEYS.answeredAt] || !!role || focus.length > 0,
    skipped: !!s[ABOUT_KEYS.skippedAt],
    asked: !!s[ABOUT_KEYS.askedAt],
    storedTitle: str(s.title, 60),
  }
}

/** Their role in words: "CFO", or what they typed for Other. */
export function roleLabel(a: Pick<About, 'role' | 'roleOther'>): string | null {
  if (!a.role) return null
  if (a.role === 'other') return a.roleOther
  return [...EXEC_ROLES, ...EMPLOYEE_ROLES].find((o) => o.id === a.role)?.label ?? null
}

/** A best guess from a title typed earlier ("Chief Financial Officer" → cfo). Only a default for the card; never stored on its own. */
export function guessRole(title: string | null | undefined, who: Audience): string | null {
  const t = String(title ?? '').toLowerCase()
  if (!t) return null
  if (who === 'employee') {
    if (/assistant/.test(t)) return 'ea'
    if (/recruit|onboard|licens|contract/.test(t)) return 'recruiting'
    if (/commission|financ|account|payroll/.test(t)) return 'finance'
    if (/market/.test(t)) return 'marketing'
    if (/support|service|success/.test(t)) return 'support'
    if (/sales|agent|producer/.test(t)) return 'sales'
    if (/ops|operat|admin/.test(t)) return 'ops_admin'
    return null
  }
  if (/\bcfo\b|financ/.test(t)) return 'cfo'
  if (/\bcmo\b|marketing/.test(t) && !/vp|director/.test(t)) return 'cmo'
  if (/\bcoo\b|operating officer/.test(t)) return 'coo'
  if (/\bceo\b|founder|chief executive/.test(t)) return 'ceo'
  if (/president/.test(t) && !/vice/.test(t)) return 'president'
  if (/executive assistant|\bea\b/.test(t)) return 'ea'
  if (/recruit/.test(t) && /head|chief|director/.test(t)) return 'recruiting_head'
  if (/sales/.test(t) && /head|chief|\bcso\b/.test(t)) return 'sales_head'
  if (/\bvp\b|vice president|director/.test(t)) return 'vp'
  if (/ops|operat|admin/.test(t)) return 'ops_admin'
  return null
}

/** The usual picks for a role when they have not chosen any. Most important first. */
export const ROLE_DEFAULTS: Record<'insurance' | 'general', Record<string, string[]>> = {
  insurance: {
    ceo: ['submitted_ap', 'top_slipping', 'agencies', 'revenue', 'board'],
    president: ['submitted_ap', 'agencies', 'top_slipping', 'placement', 'board'],
    coo: ['followups', 'placement', 'retention', 'carriers', 'calendar'],
    cfo: ['revenue', 'cash', 'persistency', 'carriers', 'board'],
    cmo: ['recruiting', 'submitted_ap', 'top_slipping', 'agencies', 'retention'],
    sales_head: ['submitted_ap', 'top_slipping', 'agencies', 'placement'],
    recruiting_head: ['recruiting', 'retention', 'top_slipping', 'hiring'],
    vp: ['top_slipping', 'submitted_ap', 'followups', 'agencies'],
    ops_admin: ['followups', 'placement', 'carriers', 'calendar'],
    ea: ['calendar', 'followups', 'board'],
  },
  general: {
    ceo: ['revenue', 'cash', 'team', 'board'],
    president: ['revenue', 'team', 'ops', 'board'],
    coo: ['ops', 'followups', 'team', 'hiring', 'approvals'],
    cfo: ['cash', 'revenue', 'churn', 'board'],
    cmo: ['marketing', 'revenue', 'churn'],
    sales_head: ['revenue', 'team'],
    recruiting_head: ['hiring', 'team', 'followups'],
    vp: ['team', 'followups'],
    ops_admin: ['ops', 'followups', 'approvals', 'calendar'],
    ea: ['calendar', 'followups', 'approvals'],
  },
}

/** Their picks (valid for this tenant), else the usual ones for their role. `picked` says which. */
export function effectiveFocus(a: Pick<About, 'role' | 'focus'>, who: Audience, f: Flavor): { ids: string[]; picked: boolean } {
  const allowed = new Set(focusOptionsFor(who, f).map((o) => o.id))
  const mine = a.focus.filter((id) => allowed.has(id))
  if (mine.length) return { ids: mine, picked: true }
  const defaults = a.role ? ROLE_DEFAULTS[f.insurance ? 'insurance' : 'general'][a.role] ?? [] : []
  return { ids: defaults.filter((id) => allowed.has(id)), picked: false }
}

export const focusLabel = (id: string, who: Audience, f: Flavor): string | null => focusOptionsFor(who, f).find((o) => o.id === id)?.label ?? null

// ── (a) The first-day card: which abilities to list first ─────────────────────

/** Capability ids (lib/agent/cxoCatalog CAPABILITIES) behind each focus. */
export const FOCUS_CAPS: Record<string, string[]> = {
  submitted_ap: ['producers', 'revenue', 'plan'],
  placement: ['producers', 'slipping'],
  retention: ['producers', 'slipping'],
  recruiting: ['producers', 'people', 'hr'],
  top_slipping: ['slipping', 'producers'],
  agencies: ['producers', 'slipping'],
  carriers: ['plan', 'producers', 'partners'],
  persistency: ['producers'],
  revenue: ['revenue', 'finance', 'payroll', 'plan'],
  cash: ['finance', 'payroll'],
  followups: ['followups', 'todos', 'approvals', 'messages', 'people'],
  calendar: ['calendar', 'calendar_conflicts', 'meetings', 'leadership_agenda'],
  board: ['board_update', 'decisions', 'leadership_agenda'],
  hiring: ['hr', 'people', 'adoption'],
  team: ['people', 'followups', 'adoption'],
  churn: ['finance', 'revenue'],
  marketing: ['revenue', 'sheets'],
  ops: ['followups', 'cards', 'approvals', 'todos'],
  partners: ['partners'],
  approvals: ['approvals'],
}

/** Capability ids an employee in this role uses most. */
export const EMPLOYEE_ROLE_CAPS: Record<string, string[]> = {
  sales: ['my_quota', 'todos', 'calendar'],
  support: ['todos', 'messages', 'search'],
  ops_admin: ['todos', 'cards', 'followups', 'messages'],
  recruiting: ['calendar', 'todos', 'messages'],
  marketing: ['todos', 'cards', 'sheets'],
  finance: ['my_quota', 'sheets', 'todos'],
  ea: ['calendar', 'calendar_conflicts', 'todos', 'messages'],
}

export type CapItem = { id: string; label: string }

/**
 * Their abilities, the ones that fit them first: what they keep an eye on (in
 * their order), then what their role uses, then everything else in the usual
 * order. Nothing is added or dropped, only ordered; the caller slices.
 */
export function pickAbilities(items: CapItem[], a: Pick<About, 'role' | 'focus'>, who: Audience, f: Flavor): CapItem[] {
  const order: string[] = []
  const push = (ids: string[]) => {
    for (const id of ids) if (!order.includes(id)) order.push(id)
  }
  for (const fid of effectiveFocus(a, who, f).ids) push(FOCUS_CAPS[fid] ?? [])
  if (who === 'employee' && a.role) push(EMPLOYEE_ROLE_CAPS[a.role] ?? [])
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i < 0 ? order.length : i
  }
  return items
    .map((it, i) => ({ it, i }))
    .sort((x, y) => rank(x.it.id) - rank(y.it.id) || x.i - y.i)
    .map((x) => x.it)
}

// ── (b) Ciao's prompt ─────────────────────────────────────────────────────────

/** The reads that answer each focus, in the words Ciao's playbook uses. Shown only when the caller has the tool. */
export const FOCUS_READS: Record<string, Array<{ tool: string; how: string }>> = {
  submitted_ap: [{ tool: 'producer_production', how: 'producer_production view=rank period=mtd (totals vs the same days last month)' }],
  placement: [{ tool: 'producer_production', how: 'producer_production view=placement period=mtd' }],
  retention: [{ tool: 'producer_production', how: 'producer_production view=retention' }],
  recruiting: [{ tool: 'producer_production', how: 'producer_production view=new period=qtd' }],
  top_slipping: [
    { tool: 'whats_slipping', how: 'whats_slipping' },
    { tool: 'producer_production', how: 'producer_production view=slipping' },
  ],
  agencies: [{ tool: 'producer_production', how: 'producer_production view=rank period=mtd (agencies_by_submitted_ap)' }],
  carriers: [{ tool: 'producer_production', how: 'producer_production view=placement by=carrier' }],
  persistency: [{ tool: 'producer_production', how: 'producer_production view=rank metric=persistency period=last_12m' }],
  revenue: [
    { tool: 'pinnacle_revenue', how: 'pinnacle_revenue view=summary' },
    { tool: 'quickbooks_financials', how: 'quickbooks_financials (revenue)' },
    { tool: 'payroll', how: 'payroll view=summary (commissions)' },
  ],
  cash: [
    { tool: 'quickbooks_financials', how: 'quickbooks_financials (expenses and net margin)' },
    { tool: 'payroll', how: 'payroll view=unpaid' },
  ],
  followups: [
    { tool: 'list_followups', how: 'list_followups view=overdue' },
    { tool: 'list_my_todos', how: 'list_my_todos' },
  ],
  calendar: [{ tool: 'list_calendar_events', how: 'list_calendar_events window=today' }],
  board: [{ tool: 'board_update', how: 'board_update (the latest draft and its headline numbers)' }],
  hiring: [{ tool: 'employee_quota_status', how: 'employee_quota_status' }],
  team: [{ tool: 'employee_quota_status', how: 'employee_quota_status filter=behind' }],
  churn: [{ tool: 'quickbooks_financials', how: 'quickbooks_financials (by customer)' }],
  marketing: [{ tool: 'quickbooks_financials', how: 'quickbooks_financials (marketing spend)' }],
  ops: [
    { tool: 'list_followups', how: 'list_followups view=overdue' },
    { tool: 'whats_slipping', how: 'whats_slipping' },
  ],
  partners: [{ tool: 'list_partners', how: 'list_partners' }],
  approvals: [{ tool: 'list_approvals', how: 'list_approvals' }],
}

/**
 * The "About this person" block for Ciao's prompt. Answered: their role and
 * what they care about, with the reads that answer it, so open-ended asks
 * lead with their metrics. Not answered: Ciao may ask the role once.
 * `askOnce` is true when the block invites that one question.
 */
export function aboutPromptBlock(
  a: About,
  opts: { who: Audience; flavor: Flavor; tools: ReadonlySet<string>; firstName: string; canSave: boolean },
): { text: string; askOnce: boolean } | null {
  const { who, flavor, tools, firstName } = opts
  const role = roleLabel(a)
  const eff = effectiveFocus(a, who, flavor)
  const labels = eff.ids.map((id) => focusLabel(id, who, flavor)).filter((x): x is string => !!x)
  const lines: string[] = []
  if (role || labels.length) {
    const roleBit = role ? `role ${role}` : a.storedTitle ? `title ${a.storedTitle}` : null
    const careBit = labels.length ? `${eff.picked ? 'cares most about' : `as a ${role}, likely cares most about`} ${labels.join(', ')}` : null
    lines.push(`- About this person: ${[roleBit, careBit].filter(Boolean).join('; ')}.`)
    if (labels.length && who === 'exec') {
      const reads: string[] = []
      for (const id of eff.ids) for (const r of FOCUS_READS[id] ?? []) if (tools.has(r.tool) && !reads.includes(r.how)) reads.push(r.how)
      lines.push(
        `- Open-ended asks ("how are we doing", "what should I look at", "brief me", a morning brief, board prep): lead with ${labels.slice(0, 3).join(', ')}, in that order, then the usual headline.` +
          (reads.length ? ` Reads for that, in the same go as the usual ones: ${reads.slice(0, 5).join('; ')}.` : ''),
      )
      lines.push('- A specific question still gets exactly what was asked. Never say you are leading with their picks; just do it.')
    }
    if (opts.canSave) lines.push(`- They can change this any time ("I care more about recruiting now", "I'm the CFO now") → set_my_focus, then confirm in one line.`)
    return { text: ['', `## About ${firstName}`, ...lines].join('\n'), askOnce: false }
  }
  // Nothing known. A title someone typed earlier is still worth a line.
  if (a.storedTitle) lines.push(`- About this person: title ${a.storedTitle} (from their profile).`)
  // Skipping the card is an answer too: no asking in chat after that.
  const askOnce = opts.canSave && !a.asked && !a.skipped
  if (askOnce) {
    const line = a.storedTitle
      ? `"By the way, you're down as ${a.storedTitle}. What do you want me to lead with when you ask how we're doing?"`
      : `"By the way, what's your role? I'll lead with what matters to you."`
    lines.push(
      `- You do not know their role${a.storedTitle ? ' (only the title above) or' : ' or'} what they want to keep an eye on yet. Only when an open-ended ask ("how are we doing", "what should I look at", a brief) would be better for knowing it: answer first, then add this one line at the end: ${line} Ask it once only, never in a reply to a specific task, never again after. When they answer, save it with set_my_focus.`,
    )
  }
  return lines.length ? { text: ['', `## About ${firstName}`, ...lines].join('\n'), askOnce } : null
}

/**
 * Did this reply ask the one-time question (their role, or what to lead with)?
 * Generous on purpose: a false yes only means Ciao never asks again, a false
 * no would let it ask twice.
 */
export function askedRoleQuestion(reply: string): boolean {
  const questions = String(reply ?? '').match(/[^.?!\n]*\?/g) ?? []
  return questions.some((q) => /\byour (?:role|title|job)\b|\blead with\b|\bkeep an eye on\b|\bcare (?:most |more )?about\b|\bfocus on\b|\bmatters (?:most )?to you\b/i.test(q))
}

// ── Saving ───────────────────────────────────────────────────────────────────

export type AboutPatch = {
  role?: string | null
  roleOther?: string | null
  focus?: string[]
  /** Added to the front of their list ("I care more about recruiting now"). */
  focusAdd?: string[]
  focusRemove?: string[]
  skip?: boolean
}

export type AboutSaveResult = { ok: true; settings: Record<string, unknown>; about: About } | { ok: false; error: string }

/**
 * Apply a change to their settings (a copy). Role ids and chips are checked
 * against this person's own lists. A skip only records the skip.
 */
export function applyAbout(settings: Record<string, unknown> | null | undefined, patch: AboutPatch, who: Audience, f: Flavor, now: Date): AboutSaveResult {
  const next: Record<string, unknown> = { ...(settings ?? {}) }
  const stamp = now.toISOString()
  if (patch.skip) {
    next[ABOUT_KEYS.skippedAt] = stamp
    return { ok: true, settings: next, about: readAbout(next) }
  }
  let touched = false
  if (patch.role !== undefined) {
    if (patch.role === null || patch.role === '') {
      delete next[ABOUT_KEYS.role]
      delete next[ABOUT_KEYS.roleOther]
    } else {
      if (!rolesFor(who).some((o) => o.id === patch.role)) return { ok: false, error: 'Pick a role from the list.' }
      next[ABOUT_KEYS.role] = patch.role
      if (patch.role === 'other') {
        const other = str(patch.roleOther, ROLE_OTHER_MAX)
        if (!other) return { ok: false, error: 'Type your role.' }
        next[ABOUT_KEYS.roleOther] = other
      } else delete next[ABOUT_KEYS.roleOther]
      // Their title on the rail, only when none was set (a typed title always wins).
      const label = roleLabel({ role: patch.role, roleOther: (next[ABOUT_KEYS.roleOther] as string | undefined) ?? null })
      if (label && !str(next.title, 60)) next.title = label
    }
    touched = true
  }
  const allowed = new Set(focusOptionsFor(who, f).map((o) => o.id))
  const clean = (ids: unknown): string[] => (Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && allowed.has(x)) : [])
  // Adding or dropping one starts from what is in effect now (their picks, or their role's defaults).
  const current = effectiveFocus(readAbout(next), who, f).ids
  let focus: string[] | null = null
  if (patch.focus !== undefined) focus = clean(patch.focus)
  if (patch.focusAdd?.length || patch.focusRemove?.length) {
    const base = focus ?? current
    const add = clean(patch.focusAdd)
    const drop = new Set(clean(patch.focusRemove))
    focus = [...add, ...base.filter((id) => !add.includes(id))].filter((id) => !drop.has(id))
  }
  if (focus) {
    focus = [...new Set(focus)].slice(0, FOCUS_MAX)
    if (focus.length) next[ABOUT_KEYS.focus] = focus
    else delete next[ABOUT_KEYS.focus]
    touched = true
  }
  if (!touched) return { ok: false, error: 'Nothing to save.' }
  next[ABOUT_KEYS.answeredAt] = stamp
  return { ok: true, settings: next, about: readAbout(next) }
}

/** What the card and Profile pane show for one person. */
export type AboutView = {
  who: Audience
  roles: Option[]
  focusOptions: Option[]
  role: string | null
  roleOther: string | null
  focus: string[]
  /** Role we would preselect from a title typed earlier. */
  guess: string | null
  answered: boolean
  skipped: boolean
  /** The card asks: not answered, not skipped. */
  ask: boolean
}

export function aboutView(a: About, who: Audience, f: Flavor): AboutView {
  return {
    who,
    roles: rolesFor(who),
    focusOptions: focusOptionsFor(who, f),
    role: a.role,
    roleOther: a.roleOther,
    focus: a.focus,
    guess: a.role ? null : guessRole(a.storedTitle, who),
    answered: a.answered,
    skipped: a.skipped,
    ask: !a.answered && !a.skipped,
  }
}
