// Formal HTML email digest for CXO execs. Daily = compact morning recap;
// weekly (Monday) = fuller framing. Revenue block only present for Pinnacle
// viewers (caller passes pinnacle=null otherwise).

import type { ExecDigest } from './digest'
import { fmtM, type PinnacleBriefData } from './summary'

export type DigestMode = 'daily' | 'weekly'

function fmtTime(iso: string, tz: string): string {
  if (iso.length === 10) return 'All day'
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
  } catch {
    return ''
  }
}

// Default chrome palette = VC. The renderExecEmail caller can override
// `bg` / `border` / `muted` / `ink` via the EmailBrand payload so a CXO
// digest renders on vanilla canvas with charcoal ink instead of the
// near-white VC chrome. Status colors (ok/info/red) stay brand-neutral
// because alerts need to read consistently regardless of tenant.
const C_DEFAULT = {
  ink: '#0f0f0f',
  muted: '#6B7280',
  border: '#E5E5E5',
  ok: '#16a34a',
  info: '#2563eb',
  red: '#c21a00',
  bg: '#FDFDFB',
}

type EmailPalette = typeof C_DEFAULT

function statBox(C: EmailPalette, label: string, value: string, color?: string): string {
  const valueColor = color ?? C.ink
  return `<td style="padding:0 8px;vertical-align:top;">
    <div style="border:1px solid ${C.border};border-radius:10px;padding:12px 14px;">
      <div style="font-size:22px;font-weight:800;color:${valueColor};line-height:1;">${value}</div>
      <div style="font-size:11px;color:${C.muted};margin-top:6px;text-transform:uppercase;letter-spacing:.4px;">${label}</div>
    </div>
  </td>`
}

function section(C: EmailPalette, title: string, body: string): string {
  return `<div style="margin-top:22px;">
    <div style="font-size:13px;font-weight:700;color:${C.ink};border-bottom:2px solid ${C.border};padding-bottom:6px;">${title}</div>
    <div style="margin-top:10px;">${body}</div>
  </div>`
}

export type EmailBrand = {
  name: string
  logoSrc: string
  accent: string
  /** Optional chrome overrides — CXO callers pass cream-vanilla bg + charcoal
   *  ink so the whole digest reads as CXO, not just the accent strip. */
  bg?: string
  ink?: string
  muted?: string
  border?: string
  /** Highlight surface for the AI-summary card (cream-vanilla on CXO). */
  paper2?: string
}

export function renderExecEmail(input: {
  digest: ExecDigest
  pinnacle: PinnacleBriefData | null
  aiSummary: string
  name: string
  timezone: string
  mode: DigestMode
  /** Brand identity for the email chrome (logo, accent, name). */
  brand: EmailBrand
}): { subject: string; html: string; text: string } {
  const { digest: d, pinnacle: p, aiSummary, name, timezone: tz, mode, brand } = input
  const accent = brand.accent
  // Per-render palette — caller-supplied chrome overrides fall back to the
  // VC defaults. CXO callers pass vanilla bg + cream-vanilla card surface
  // so the whole digest reads as CXO, not just the accent strip.
  const C: EmailPalette = {
    ...C_DEFAULT,
    ...(brand.bg ? { bg: brand.bg } : {}),
    ...(brand.ink ? { ink: brand.ink } : {}),
    ...(brand.muted ? { muted: brand.muted } : {}),
    ...(brand.border ? { border: brand.border } : {}),
  }
  // Subtle highlight surface for the AI-summary card. Cream-vanilla on CXO,
  // VC's existing #f7f4ef on VC. Driven off `paper2` which the caller can
  // pass alongside the other chrome overrides; absent → VC default.
  const cardSurface = (brand as { paper2?: string }).paper2 ?? '#f7f4ef'
  const first = name.split(' ')[0] || name
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: tz,
  })

  // Revenue block
  let revenueHtml = ''
  if (p) {
    const pace = p.pacePct != null ? `${p.pacePct >= 0 ? '+' : ''}${Math.round(p.pacePct * 100)}% vs last mo` : '—'
    const paceColor = (p.pacePct ?? 0) >= 0 ? C.ok : C.red
    const teams = p.topTeams
      .slice(0, 3)
      .map(
        (t, i) =>
          `<div style="font-size:13px;padding:4px 0;color:${C.ink};">${i + 1}. ${t.name} <span style="color:${C.muted};">— ${fmtM(
            t.premium,
          )}</span></div>`,
      )
      .join('')
    revenueHtml = section(
      C,
      'Pinnacle revenue',
      `<table cellpadding="0" cellspacing="0" style="margin:0 -8px;"><tr>
        ${statBox(C, 'MTD premium', fmtM(p.mtdPremium))}
        ${statBox(C, 'Projected', fmtM(p.projected), accent)}
        ${statBox(C, 'Placement', `${Math.round(p.placementPct * 100)}%`, C.ok)}
      </tr></table>
      <div style="font-size:12px;color:${paceColor};margin-top:8px;font-weight:600;">Pace: ${pace}</div>
      ${teams ? `<div style="margin-top:12px;"><div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">Top teams (MTD)</div>${teams}</div>` : ''}`,
    )
  }

  // Calendar
  let calHtml = ''
  if (d.todayEvents && d.todayEvents.length > 0) {
    const rows = d.todayEvents
      .slice(0, 8)
      .map((e) => {
        const join = e.conferenceLink ? ` &middot; <a href="${e.conferenceLink}" style="color:${C.info};text-decoration:none;">join</a>` : ''
        return `<div style="font-size:13px;padding:4px 0;"><span style="color:${C.muted};font-weight:700;display:inline-block;min-width:74px;">${fmtTime(
          e.start,
          tz,
        )}</span> ${e.summary || '(untitled)'}${join}</div>`
      })
      .join('')
    calHtml = section(C, `Today — ${d.todayEvents.length} ${d.todayEvents.length === 1 ? 'meeting' : 'meetings'}`, rows)
  } else if (d.todayEvents) {
    calHtml = section(C, 'Today', `<div style="font-size:13px;color:${C.muted};">Nothing on the calendar.</div>`)
  }

  // Waiting on you
  const waiting: string[] = []
  if (d.pendingDrafts > 0) waiting.push(`${d.pendingDrafts} email draft${d.pendingDrafts === 1 ? '' : 's'} to approve`)
  if (d.unansweredThreads > 0) waiting.push(`${d.unansweredThreads} email${d.unansweredThreads === 1 ? '' : 's'} to answer`)
  if (d.quietDeals.length > 0) waiting.push(`${d.quietDeals.length} deal${d.quietDeals.length === 1 ? '' : 's'} gone quiet`)
  const waitingHtml = waiting.length
    ? section(C, 'Waiting on you', waiting.map((w) => `<div style="font-size:13px;padding:3px 0;">• ${w}</div>`).join(''))
    : ''

  // Quiet deals detail
  const quietHtml =
    d.quietDeals.length > 0
      ? section(
          C,
          'Gone quiet',
          d.quietDeals
            .map(
              (q) =>
                `<div style="font-size:13px;padding:3px 0;">${q.name}${q.company ? ` · ${q.company}` : ''}${
                  q.value ? ` <span style="color:${C.muted};">(${fmtM(q.value)})</span>` : ''
                } — ${q.days}d no contact</div>`,
            )
            .join(''),
        )
      : ''

  const aiHtml = aiSummary
    ? `<div style="font-size:15px;line-height:1.5;color:${C.ink};background:${cardSurface};border-radius:10px;padding:14px 16px;margin-top:4px;">${aiSummary}</div>`
    : ''

  const subject =
    mode === 'weekly'
      ? `Weekly brief — ${dateLabel}${p ? ` · ${fmtM(p.mtdPremium)} MTD` : ''}`
      : `Morning brief — ${dateLabel}${p ? ` · ${fmtM(p.mtdPremium)} MTD` : ''}`

  const html = `<!doctype html><html><body style="margin:0;background:${C.bg};">
  <div style="max-width:600px;margin:0 auto;padding:28px 22px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">
    <div style="display:flex;align-items:center;gap:10px;border-bottom:2px solid ${accent};padding-bottom:14px;">
      <img src="${brand.logoSrc}" alt="${brand.name}" height="34" style="height:34px;width:auto;display:block;" />
      <span style="font-size:15px;font-weight:700;letter-spacing:.3px;color:${accent};">${brand.name}</span>
    </div>
    <div style="font-size:12px;color:${C.muted};text-transform:uppercase;letter-spacing:.6px;margin-top:18px;">${
      mode === 'weekly' ? 'Weekly Executive Brief' : 'Morning Executive Brief'
    }</div>
    <h1 style="font-size:22px;margin:6px 0 2px;color:${accent};">Good morning, ${first}.</h1>
    <div style="font-size:13px;color:${C.muted};">${dateLabel}</div>
    <div style="margin-top:16px;">${aiHtml}</div>
    ${revenueHtml}
    ${calHtml}
    ${waitingHtml}
    ${quietHtml}
    <div style="margin-top:26px;font-size:12px;color:${C.muted};border-top:1px solid ${C.border};padding-top:12px;">
      Reply in Telegram to act on any of this — your assistant is listening.
    </div>
  </div></body></html>`

  // Plain-text fallback
  const textLines = [
    `${mode === 'weekly' ? 'Weekly' : 'Morning'} brief — ${dateLabel}`,
    '',
    aiSummary,
    '',
  ]
  if (p) {
    textLines.push(
      `Revenue MTD: ${fmtM(p.mtdPremium)} → projected ${fmtM(p.projected)}${
        p.pacePct != null ? ` (${p.pacePct >= 0 ? '+' : ''}${Math.round(p.pacePct * 100)}% vs last mo)` : ''
      } · placement ${Math.round(p.placementPct * 100)}%`,
    )
  }
  if (d.todayEvents && d.todayEvents.length) {
    textLines.push('', `Today (${d.todayEvents.length}):`)
    for (const e of d.todayEvents.slice(0, 8)) textLines.push(`  ${fmtTime(e.start, tz)} ${e.summary}`)
  }
  if (waiting.length) textLines.push('', 'Waiting on you:', ...waiting.map((w) => `  - ${w}`))

  return { subject, html, text: textLines.filter((l) => l !== undefined).join('\n') }
}
