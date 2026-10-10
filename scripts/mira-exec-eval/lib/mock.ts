/**
 * Mock answer function for dry-running the harness without a database or an
 * AI key. Produces exec-style answers from the mock ground truth and
 * injects ~15% deliberate failures so grade.ts's checks and the report's
 * failure clusters are exercised end to end.
 */
import type { Question } from './types'
import type { GTValue } from './groundTruth'
import { rng } from './util'

export type MockResult = { answer: string; intents: Array<Record<string, unknown>>; tools_used: string[]; input_tokens: number; output_tokens: number; turns: number; injected: string | null }

const usd = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`)
const cnt = (n: number) => n.toLocaleString('en-US')
const NO_DATA = (label: string) => `I don't have any data for ${label} — the synced book starts in January 2026. Nearest I can give you is the 2026 figure; want that?`

export function mockAnswer(q: Question, gt: GTValue, seed: number): MockResult {
  const r = rng(seed * 7 + [...q.id].reduce((s, c) => s + c.charCodeAt(0), 0))
  const fail = r() < 0.15
  const injected = fail ? (['wrong_number', 'hallucinated_compare', 'invented_entity', 'too_long', 'evasive', 'wrong_period', 'no_action', 'claimed_unsent_action'] as const)[Math.floor(r() * 8)] : null
  const tools: string[] = []
  const intents: Array<Record<string, unknown>> = []
  const pl = q.meta.period_label ?? 'this period'
  let answer = ''
  const fudge = injected === 'wrong_number' ? 1.37 : 1
  const periodWord = injected === 'wrong_period' ? 'in 2024' : pl

  if (q.expected_kind === 'action') {
    const wants = q.meta.expects_intents ?? []
    if (/draft|write|put together|note|email|turn|make me|text/i.test(q.text) && wants.length === 0) {
      tools.push('pinnacle_revenue')
      answer = injected === 'claimed_unsent_action' ? `Done — I've sent that email with the September numbers ($20.4M submitted, 78% placement).` : `Here's a draft:\n\nSubject: September numbers\n\nSeptember closed at $20.4M submitted premium on 6,000 apps, placement 78%. Life led at $12.6M. Say the word and I'll send it, or tweak the tone.`
    } else if (wants.length) {
      if (injected !== 'no_action') intents.push({ kind: wants[0], when: '2026-10-10', note: q.text.slice(0, 60) })
      answer = injected === 'no_action' ? `I'm not able to set reminders from here.` : `Done — set for Friday Oct 10: ${q.text.replace(/^.*?(to|:)\s+/i, '').slice(0, 60)}.`
    } else {
      answer = `I can draft that, but I can only send to people in the lead list by name or to an address you give me. Who should it go to?`
    }
  } else if (q.category === 'calendar_actions' && q.expected_kind === 'list') {
    tools.push('list_calendar_events')
    answer = injected === 'invented_entity' ? `You have 3 today: 9am Board sync, 11am Carrier review with Transamerica, 2pm 1:1 with Brad.` : `Your calendar isn't connected yet, so I can't see today's events. Connect Google in Settings and I'll pull them.`
  } else if (q.category === 'calendar_actions') {
    answer = `I don't have access to meeting notes or transcripts, so I can't recap that one. I can pull the numbers that were likely discussed, or draft follow-up questions — which?`
  } else if (gt.kind === 'number') {
    tools.push('pinnacle_revenue')
    if (gt.empty && /2025|2024|last year|calendar/.test(gt.label + pl)) {
      answer = injected === 'hallucinated_compare' ? `${pl} came in at ${usd(18_400_000)}, roughly 12% above the prior year.` : NO_DATA(pl)
    } else if (gt.empty) {
      answer = `Nothing has synced for ${pl} yet — the figure shows $0. Last sync was this morning; I'd check with ops before reading it as a real zero.`
    } else {
      const v = gt.value * fudge
      const shown = gt.unit === 'usd' ? usd(v) : gt.unit === 'pct' ? `${(v).toFixed(1)}%` : cnt(Math.round(v))
      answer = `${shown} ${periodWord}` + (gt.extra && 'applications' in gt.extra ? ` (${cnt(Number(gt.extra.applications))} apps, ${cnt(Number(gt.extra.paid))} paid).` : '.')
      if (q.ground_truth?.fn === 'pace') answer = `Pacing to ${shown} ${periodWord} — ${usd(Number(gt.extra?.mtd ?? gt.extra?.ytd ?? 0))} in so far. ${Number(gt.extra?.last_month ?? 0) > v ? 'Behind' : 'Ahead of'} last month's ${usd(Number(gt.extra?.last_month ?? 0))}.`
      if (injected === 'evasive') answer = `It depends on how you look at it. There are several ways to cut that number.`
      if (injected === 'too_long') answer = (answer + ' ' + 'As context, the number reflects submitted annual premium bucketed by effective date across all synced bases, excluding withdrawn applications but including those still pending underwriting decisions, and the comparison to prior periods should account for seasonality and the mix shift between Life, Health and Annuity product lines which changes the average case size. '.repeat(6)).trim()
    }
  } else if (gt.kind === 'ranking') {
    tools.push('pinnacle_revenue')
    if (gt.empty) answer = `No data ${pl} to rank — nothing has synced for that window.`
    else {
      const rows = injected === 'wrong_number' ? [...gt.rows].reverse() : gt.rows
      answer = `Top ${rows.length} ${pl}:\n` + rows.map((x, i) => `${i + 1}. ${injected === 'invented_entity' && i === 0 ? 'Team Zephyr' : x.name} — ${usd(x.premium)}`).join('\n')
    }
  } else if (gt.kind === 'compare') {
    tools.push('pinnacle_revenue')
    if (gt.b_empty) answer = injected === 'hallucinated_compare' ? `${gt.a_label}: ${usd(gt.a)}, up 14% vs ${gt.b_label}.` : `${gt.a_label}: ${usd(gt.a)}. There's no 2025 data in the synced book, so I can't give you a year-over-year comparison — the earliest month I have is January 2026.`
    else answer = `${gt.a_label}: ${gt.unit === 'usd' ? usd(gt.a * fudge) : gt.a} vs ${gt.b_label}: ${gt.unit === 'usd' ? usd(gt.b) : gt.b} (${gt.delta_pct != null && gt.delta_pct > 0 ? '+' : ''}${gt.delta_pct}%).`
  } else if (gt.kind === 'lines') {
    tools.push('pinnacle_revenue')
    answer = Object.entries(gt.values).map(([l, v]) => `${l}: ${gt.unit === 'usd' ? usd(v * fudge) : cnt(v)} (${gt.total ? Math.round((v / gt.total) * 100) : 0}%)`).join(', ') + ` ${pl}.`
  } else if (gt.kind === 'trend') {
    tools.push('pinnacle_revenue')
    answer = gt.months.map((m) => `${m.month}: ${usd(m.premium)}`).join('\n') + `\nJuly–Sep look light; those months may not be fully synced yet.`
  } else if (gt.kind === 'entity') {
    tools.push('pinnacle_revenue')
    if (!gt.found) answer = injected === 'invented_entity' ? `${gt.name} wrote ${usd(2_300_000)} ${pl}, ranking #6.` : `I don't see "${gt.name}" in the data ${pl}. Closest names: ${gt.suggestions.join(', ')}. Did you mean one of those?`
    else answer = `${gt.name}: ${usd(gt.value * fudge)} ${pl}, #${gt.rank} overall.`
  } else if (gt.kind === 'freshness') {
    answer = `Last Airtable sync: ${gt.last_sync}. Data runs ${gt.earliest} to ${gt.latest}; there is no 2025 data loaded.`
  } else {
    tools.push('pinnacle_revenue')
    answer = /dental|p&c|property|persistency|commission|spend|licensed|face amount|nps|loss ratio/i.test(q.text)
      ? `That isn't in the book-of-business data I have (premium, policies, status by carrier/agent/team/state/product). Closest thing I can give you is the lapse rate or premium — want either?`
      : injected === 'evasive'
        ? `Hard to say.`
        : `Short answer: it's early in the month and Jul–Sep haven't fully synced, so the dip is mostly a data-timing artifact, not a production problem. Next step: confirm with ops that the Airtable sync completed.`
  }
  const input_tokens = 7_200 + Math.floor(r() * 3_000) + tools.length * 2_500
  const output_tokens = Math.ceil(answer.length / 3.6) + 120
  return { answer, intents, tools_used: tools, input_tokens, output_tokens, turns: 1 + tools.length, injected }
}
