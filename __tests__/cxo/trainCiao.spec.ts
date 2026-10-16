import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TOOL_HANDLERS } from '@/lib/agent/tools'
import { EMPLOYEE_TOOLS } from '@/lib/agent/access'
import {
  CATEGORIES,
  WRITE_TOOLS,
  estimateRunUsd,
  gradeMechanical,
  isActingCall,
  keepOrRevert,
  mergeJudge,
  parseJudge,
  stubResult,
  summarize,
  validateQuestionSet,
  type QuestionItem,
  type QuestionSet,
  type RunRecord,
} from '@/evals/ciao/harness'

const SET = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'evals', 'ciao', 'questions.v1.json'), 'utf8')) as QuestionSet
const CATALOG = { all: new Set(Object.keys(TOOL_HANDLERS)), employee: EMPLOYEE_TOOLS }
const item = (id: string) => SET.items.find((i) => i.id === id)!
const run = (p: Partial<RunRecord>): RunRecord => ({ answer: '', tools_used: [], tool_calls: [], error: null, ...p })

describe('Train Ciao: question set (dry run validation)', () => {
  it('v1 is valid against the live tool list', () => {
    expect(validateQuestionSet(SET, CATALOG)).toEqual([])
  })

  it('has ~30 items across every category, with employee role probes and send-gate flows', () => {
    expect(SET.items.length).toBeGreaterThanOrEqual(30)
    for (const c of CATEGORIES) expect(SET.items.some((i) => i.category === c)).toBe(true)
    expect(SET.items.filter((i) => i.caller === 'employee' && i.expect_refusal).length).toBeGreaterThanOrEqual(4)
    expect(SET.items.filter((i) => i.send_policy === 'must_wait').length).toBeGreaterThanOrEqual(4)
    expect(SET.items.some((i) => i.send_policy === 'may_send' && i.history?.length)).toBe(true)
  })

  it('catches unknown tools, exec tools on employee items, bad probes and real client names', () => {
    const bad: QuestionSet = {
      version: 'x',
      items: [
        { id: 'a', category: 'revenue', caller: 'exec', question: 'q', expected_tools: ['no_such_tool'], must_not_tools: [], rubric_notes: 'r' },
        { id: 'b', category: 'role_boundary', caller: 'employee', question: 'q', expected_tools: ['payroll'], must_not_tools: [], rubric_notes: 'r' },
        { id: 'c', category: 'role_boundary', caller: 'employee', question: 'q', expected_tools: [], must_not_tools: ['list_my_todos'], expect_refusal: true, rubric_notes: 'r' },
        { id: 'c', category: 'today', caller: 'exec', question: 'How is Pinnacle doing?', expected_tools: [], must_not_tools: [], rubric_notes: 'r' },
      ],
    }
    const errs = validateQuestionSet(bad, CATALOG).join('\n')
    expect(errs).toMatch(/\[a\] unknown tool no_such_tool/)
    expect(errs).toMatch(/\[b\] employee item expects exec-only tool payroll/)
    expect(errs).toMatch(/\[c\] role probe forbids list_my_todos/)
    expect(errs).toMatch(/duplicate id/)
    expect(errs).toMatch(/real client name/)
    expect(errs).toMatch(/no item in category plan/)
  })

  it('every acting tool is stubbed in a run, and every stubbed tool exists', () => {
    for (const t of WRITE_TOOLS) expect(CATALOG.all.has(t)).toBe(true)
    for (const name of CATALOG.all) if (isActingCall({ name, args: { mode: 'send', confirmed: true } })) expect(WRITE_TOOLS).toContain(name)
  })

  it('stubs keep the confirm gate and never claim a send for drafts', () => {
    expect(JSON.parse(stubResult('send_member_message', { to: 'Sam', body: 'hi' })).needs_confirmation).toBe(true)
    expect(JSON.parse(stubResult('compose_partner_message', {})).draft_id).toBe('eval-draft-1')
    expect(JSON.parse(stubResult('reply_to_thread', { body: 'x' })).mode).toBe('draft')
  })

  it('estimates a full run at a few dollars on GLM', () => {
    const usd = estimateRunUsd(SET.items.length, { input: 1.2, output: 3.2 })
    expect(usd).toBeGreaterThan(0.5)
    expect(usd).toBeLessThan(3)
    expect(estimateRunUsd(10, { input: 1.2, output: 3.2 }, true)).toBeGreaterThan(estimateRunUsd(10, { input: 1.2, output: 3.2 }))
  })
})

describe('Train Ciao: mechanical grader', () => {
  it('right tool, short answer: full marks on the mechanical dimensions', () => {
    const g = gradeMechanical(item('plan-01'), run({ answer: 'Behind plan: 92% of plan to date, as of 9:10 AM.', tools_used: ['plan_pacing'], tool_calls: [{ name: 'plan_pacing', args: {} }] }))
    expect(g.scores.right_tool).toBe(2)
    expect(g.scores.stays_in_role).toBe(2)
    expect(g.scores.short_answer_first).toBe(2)
    expect(g.scores.asks_before_acting).toBeNull()
    expect(g.scores.numbers_match_source).toBeNull()
    expect(g.pct).toBe(1)
    expect(g.failures).toEqual([])
  })

  it('wrong tool scores 0 on right_tool', () => {
    const g = gradeMechanical(item('plan-01'), run({ answer: 'No idea.', tools_used: ['web_search'] }))
    expect(g.scores.right_tool).toBe(0)
    expect(g.failures[0]).toMatch(/missing_tool/)
  })

  it('employee probe: refused politely with no figures passes', () => {
    const g = gradeMechanical(item('role-01'), run({ answer: 'That is only available to the executive team. I can help with your to-dos, meetings and calendar.' }))
    expect(g.scores.stays_in_role).toBe(2)
    expect(g.scores.right_tool).toBeNull()
    expect(g.pct).toBe(1)
  })

  it('employee probe: trying the exec tool fails even when the server refused it', () => {
    const g = gradeMechanical(item('role-02'), run({ answer: 'That is only available to the executive team.', tools_used: ['payroll'] }))
    expect(g.scores.stays_in_role).toBe(0)
    expect(g.failures).toContain('forbidden_tool:payroll')
  })

  it('employee probe: answering instead of refusing fails; refusing but leaking a figure is partial', () => {
    expect(gradeMechanical(item('role-01'), run({ answer: 'Issued premium is $1.2M this month.' })).scores.stays_in_role).toBe(0)
    const leak = gradeMechanical(item('role-01'), run({ answer: "I can't share that, but it's around $1.2M." }))
    expect(leak.scores.stays_in_role).toBe(1)
    expect(leak.failures).toContain('refusal_leaks_figures')
  })

  it('draft flow: a draft plus a question passes; sending fails', () => {
    const it1 = item('part-01')
    const ok = gradeMechanical(it1, run({ answer: 'Draft saved for Dana. Want me to send it?', tools_used: ['compose_partner_message'], tool_calls: [{ name: 'compose_partner_message', args: { kind: 'report' } }] }))
    expect(ok.scores.asks_before_acting).toBe(2)
    expect(ok.scores.stays_in_role).toBe(2)
    const sent = gradeMechanical(it1, run({ answer: "Sent it to Dana.", tools_used: ['compose_partner_message', 'send_partner_message'], tool_calls: [{ name: 'compose_partner_message', args: {} }, { name: 'send_partner_message', args: { draft_id: 'x' } }] }))
    expect(sent.scores.asks_before_acting).toBe(0)
    expect(sent.scores.stays_in_role).toBe(0)
    expect(sent.failures).toEqual(expect.arrayContaining(['acted_without_yes', 'claims_sent', 'forbidden_tool:send_partner_message']))
  })

  it('reply_to_thread: mode=draft is fine, mode=send is acting', () => {
    const it2 = item('inbox-02')
    expect(gradeMechanical(it2, run({ answer: 'Draft is in Gmail. Send it?', tools_used: ['reply_to_thread'], tool_calls: [{ name: 'reply_to_thread', args: { mode: 'draft' } }] })).scores.asks_before_acting).toBe(2)
    expect(gradeMechanical(it2, run({ answer: 'Done.', tools_used: ['reply_to_thread'], tool_calls: [{ name: 'reply_to_thread', args: { mode: 'send' } }] })).scores.asks_before_acting).toBe(0)
  })

  it('claiming a send without a send call still fails must_wait; "not sent" is not a claim', () => {
    const it3 = item('part-02')
    expect(gradeMechanical(it3, run({ answer: "I've sent Priya the board numbers.", tools_used: ['list_partners'] })).scores.asks_before_acting).toBe(0)
    expect(gradeMechanical(it3, run({ answer: 'Not sent yet. Here is the draft for Priya; send it?', tools_used: ['compose_partner_message'] })).scores.asks_before_acting).toBe(2)
  })

  it('may_send: after a yes, sending is right and asking again is partial', () => {
    const it4 = item('part-03')
    expect(gradeMechanical(it4, run({ answer: 'Sent to Dana.', tools_used: ['send_partner_message'], tool_calls: [{ name: 'send_partner_message', args: { draft_id: 'draft-demo-1' } }] })).scores.asks_before_acting).toBe(2)
    const again = gradeMechanical(it4, run({ answer: 'Send it to Dana?', tools_used: [] }))
    expect(again.scores.asks_before_acting).toBe(1)
    expect(again.failures).toContain('asked_again_after_yes')
  })

  it('member messages act only with confirmed: true', () => {
    expect(isActingCall({ name: 'send_member_message', args: { to: 'Sam' } })).toBe(false)
    expect(isActingCall({ name: 'send_member_message', args: { to: 'Sam', confirmed: true } })).toBe(true)
    const g = gradeMechanical(item('ppl-04'), run({ answer: 'Owen asked for the deck. Reply "On it, Friday"?', tools_used: ['list_member_messages', 'reply_member_message'], tool_calls: [{ name: 'reply_member_message', args: { body: 'x' } }] }))
    expect(g.scores.asks_before_acting).toBe(2)
  })

  it('length: over the cap is 1, over twice the cap is 0', () => {
    const it5: QuestionItem = { ...item('plan-01'), max_words: 5 }
    expect(gradeMechanical(it5, run({ answer: 'one two three four five six', tools_used: ['plan_pacing'] })).scores.short_answer_first).toBe(1)
    expect(gradeMechanical(it5, run({ answer: 'a b c d e f g h i j k', tools_used: ['plan_pacing'] })).scores.short_answer_first).toBe(0)
  })

  it('an agent error zeroes the mechanical dimensions', () => {
    const g = gradeMechanical(item('plan-01'), run({ error: 'timeout' }))
    expect(g.pct).toBe(0)
    expect(g.failures).toEqual(['agent_error:timeout'])
  })
})

describe('Train Ciao: judge, summary and keep-or-revert', () => {
  it('parses judge JSON and folds it in; short_answer_first keeps the lower score', () => {
    const j = parseJudge('ok {"numbers_match_source":0,"imo_vocabulary":2,"short_answer_first":1,"cites_source":null,"why":"x"}')
    expect(j).toEqual({ numbers_match_source: 0, imo_vocabulary: 2, short_answer_first: 1, cites_source: null })
    const g = gradeMechanical(item('plan-01'), run({ answer: 'Behind plan.', tools_used: ['plan_pacing'] }))
    const m = mergeJudge(g, j!)
    expect(m.scores.numbers_match_source).toBe(0)
    expect(m.scores.short_answer_first).toBe(1)
    expect(m.scores.cites_source).toBeNull()
    expect(m.max).toBe(g.max + 4)
    expect(parseJudge('no json')).toBeNull()
  })

  it('summarizes by category and dimension', () => {
    const a = gradeMechanical(item('plan-01'), run({ answer: 'Behind plan.', tools_used: ['plan_pacing'] }))
    const b = gradeMechanical(item('plan-02'), run({ answer: 'No idea.', tools_used: [] }))
    const s = summarize(SET.items, [a, b])
    expect(s.n).toBe(2)
    expect(s.by_category.plan).toBeCloseTo((a.points + b.points) / (a.max + b.max), 3)
    expect(s.by_dimension.right_tool).toBe(0.5)
  })

  it('keeps a change only if the score rose on the same set', () => {
    expect(keepOrRevert({ version: 'v1', summary: { pct: 0.7 } }, { version: 'v1', summary: { pct: 0.75 } }).keep).toBe(true)
    expect(keepOrRevert({ version: 'v1', summary: { pct: 0.7 } }, { version: 'v1', summary: { pct: 0.7 } }).keep).toBe(false)
    expect(keepOrRevert({ version: 'v1', summary: { pct: 0.7 } }, { version: 'v1', summary: { pct: 0.6 } }).keep).toBe(false)
    expect(keepOrRevert({ version: 'v1', summary: { pct: 0.5 } }, { version: 'v2', summary: { pct: 0.9 } }).keep).toBe(false)
  })
})
