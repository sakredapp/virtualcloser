// Formal HTML email digest for CXO execs. Daily = compact morning recap;
// weekly (Monday) = fuller framing. Revenue block only present for Pinnacle
// viewers (caller passes pinnacle=null otherwise).

import type { ExecDigest } from './digest'
import { fmtM, paceWords, type PinnacleBriefData } from './summary'
import { getBrand } from '@/lib/brand'

export type DigestMode = 'daily' | 'weekly'

function fmtTime(iso: string, tz: string): string {
  if (iso.length === 10) return 'All day'
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
  } catch {
    return ''
  }
}

// Chrome palette. Defaults are the Suite CXO email look (black / silver /
// white, the same tokens as the "Due soon" email in lib/dueDigestEmail.ts).
// Callers may override via EmailBrand. One accent only: ink. Status colors
// (green/red) are gone on purpose; the pace line says up/down in words.
const C_DEFAULT = {
  ink: '#0F1012',
  muted: '#5B6067',
  border: '#E6E8EB',
  bg: '#F5F6F7',
  paper: '#FFFFFF',
}

type EmailPalette = typeof C_DEFAULT

const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
const SERIF = 'Lora,Georgia,serif'

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Small uppercase section label with a hairline under it. */
function sectionHead(C: EmailPalette, title: string): string {
  return `<tr><td style="padding:28px 0 0;">
      <div style="font:600 11px/1.2 ${FONT};letter-spacing:0.12em;text-transform:uppercase;color:${C.muted};padding-bottom:8px;border-bottom:1px solid ${C.border};">${title}</div>
    </td></tr>`
}

/** One list row: label left, optional value right, hairline under it. */
function row(C: EmailPalette, left: string, right = '', lead = ''): string {
  return `<tr>
      ${lead ? `<td width="76" style="padding:10px 12px 10px 0;border-bottom:1px solid ${C.border};font:600 13px/1.4 ${FONT};color:${C.muted};white-space:nowrap;vertical-align:top;">${lead}</td>` : ''}
      <td style="padding:10px 0;border-bottom:1px solid ${C.border};font:14px/1.45 ${FONT};color:${C.ink};vertical-align:top;">${left}</td>
      ${right ? `<td align="right" style="padding:10px 0 10px 12px;border-bottom:1px solid ${C.border};font:14px/1.45 ${FONT};color:${C.ink};white-space:nowrap;vertical-align:top;font-variant-numeric:tabular-nums;">${right}</td>` : ''}
    </tr>`
}

function listTable(rows: string): string {
  return `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>`
}

/** One equal-width stat cell. Stacks to full width under 480px. */
function statCell(C: EmailPalette, label: string, value: string, first: boolean): string {
  return `<td class="cx-stat${first ? ' cx-stat-first' : ''}" width="33%" valign="top" style="width:33%;padding:16px 0 16px ${first ? '0' : '16px'};${first ? '' : `border-left:1px solid ${C.border};`}vertical-align:top;">
      <div style="font:600 24px/1.1 ${FONT};color:${C.ink};font-variant-numeric:tabular-nums;letter-spacing:-0.01em;">${value}</div>
      <div style="font:500 11px/1.35 ${FONT};color:${C.muted};margin-top:6px;letter-spacing:0.06em;text-transform:uppercase;">${label}</div>
    </td>`
}

export type EmailBrand = {
  name: string
  /** Absolute https PNG of the real brand logo (never SVG, never typed text). */
  logoSrc: string
  /** Display width of the logo in px. Height follows the image ratio. */
  logoWidth?: number
  logoHeight?: number
  accent: string
  bg?: string
  ink?: string
  muted?: string
  border?: string
  paper?: string
  /** Legacy: unused since the 2026-10-20 redesign (summary is no longer a filled box). */
  paper2?: string
}

/**
 * Suite CXO email chrome: the real logo image only (cropped from the brand
 * PNG, hosted on suitecxo.com) on white, silver ground. Owner 2026-10-20: no
 * typed/HTML text logo and no "Suite CXO" text next to the logo.
 */
export const CXO_EMAIL_LOGO = getBrand('cxo').logo.emailSrc!

export function cxoEmailBrand(): EmailBrand {
  return {
    name: 'Suite CXO',
    logoSrc: CXO_EMAIL_LOGO.src,
    logoWidth: CXO_EMAIL_LOGO.width,
    logoHeight: CXO_EMAIL_LOGO.height,
    accent: C_DEFAULT.ink,
  }
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
  const C: EmailPalette = {
    ...C_DEFAULT,
    ...(brand.bg ? { bg: brand.bg } : {}),
    ...(brand.ink ? { ink: brand.ink } : {}),
    ...(brand.muted ? { muted: brand.muted } : {}),
    ...(brand.border ? { border: brand.border } : {}),
    ...(brand.paper ? { paper: brand.paper } : {}),
  }
  const first = name.split(' ')[0] || name
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: tz,
  })
  const kicker = mode === 'weekly' ? 'Weekly executive brief' : 'Morning executive brief'

  // Revenue block
  let revenueHtml = ''
  const pace = p ? paceWords(p) ?? 'no days to compare yet' : ''
  if (p) {
    const teams = p.topTeams.slice(0, 3)
    revenueHtml =
      sectionHead(C, 'Pinnacle revenue') +
      `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${statCell(C, 'MTD premium', fmtM(p.mtdPremium), true)}
        ${statCell(C, `Same ${p.daysCompared} days last mo`, fmtM(p.sameDaysLastMonthPremium), false)}
        ${statCell(C, 'Placement', `${Math.round(p.placementPct * 100)}%`, false)}
      </tr></table></td></tr>
      <tr><td style="padding:12px 0 0;border-top:1px solid ${C.border};font:14px/1.5 ${FONT};color:${C.ink};"><strong style="font-weight:600;">Pace:</strong> ${esc(pace)}</td></tr>` +
      (teams.length
        ? sectionHead(C, 'Top teams (MTD)') +
          listTable(teams.map((t, i) => row(C, `${i + 1}.&nbsp; ${esc(t.name)}`, fmtM(t.premium))).join(''))
        : '')
  }

  // Calendar
  let calHtml = ''
  if (d.todayEvents && d.todayEvents.length > 0) {
    const rows = d.todayEvents
      .slice(0, 8)
      .map((e) => {
        const join = e.conferenceLink
          ? ` &middot; <a href="${esc(e.conferenceLink)}" style="color:${C.ink};text-decoration:underline;">join</a>`
          : ''
        return row(C, `${esc(e.summary || '(untitled)')}${join}`, '', fmtTime(e.start, tz))
      })
      .join('')
    calHtml =
      sectionHead(C, `Today &middot; ${d.todayEvents.length} ${d.todayEvents.length === 1 ? 'meeting' : 'meetings'}`) +
      listTable(rows)
  } else if (d.todayEvents) {
    calHtml =
      sectionHead(C, 'Today') +
      `<tr><td style="padding:10px 0;font:14px/1.45 ${FONT};color:${C.muted};">Nothing on the calendar.</td></tr>`
  }

  // Waiting on you
  const waiting: Array<[string, string]> = []
  if (d.pendingDrafts > 0) waiting.push([`email draft${d.pendingDrafts === 1 ? '' : 's'} to approve`, String(d.pendingDrafts)])
  if (d.unansweredThreads > 0) waiting.push([`email${d.unansweredThreads === 1 ? '' : 's'} to answer`, String(d.unansweredThreads)])
  if (d.quietDeals.length > 0) waiting.push([`deal${d.quietDeals.length === 1 ? '' : 's'} gone quiet`, String(d.quietDeals.length)])
  const waitingWords = waiting.map(([w, n]) => `${n} ${w}`)
  const waitingHtml = waiting.length
    ? sectionHead(C, 'Waiting on you') +
      listTable(waiting.map(([w, n]) => row(C, `<strong style="font-weight:600;font-variant-numeric:tabular-nums;">${n}</strong>&nbsp; ${w}`)).join(''))
    : ''

  // Quiet deals detail
  const quietHtml =
    d.quietDeals.length > 0
      ? sectionHead(C, 'Gone quiet') +
        listTable(
          d.quietDeals
            .map((q) =>
              row(
                C,
                `${esc(q.name)}${q.company ? ` <span style="color:${C.muted};">&middot; ${esc(q.company)}</span>` : ''}${
                  q.value ? ` <span style="color:${C.muted};">(${fmtM(q.value)})</span>` : ''
                }`,
                `${q.days}d no contact`,
              ),
            )
            .join(''),
        )
      : ''

  // AI summary: plain lead paragraph with a thin ink rule, not a filled box.
  const aiHtml = aiSummary
    ? `<tr><td style="padding:20px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="3" style="width:3px;background:${C.ink};font-size:0;line-height:0;">&nbsp;</td>
        <td style="padding:2px 0 2px 16px;font:16px/1.6 ${FONT};color:${C.ink};">${aiSummary}</td>
      </tr></table></td></tr>`
    : ''

  const subject =
    mode === 'weekly'
      ? `Weekly brief — ${dateLabel}${p ? ` · ${fmtM(p.mtdPremium)} MTD` : ''}`
      : `Morning brief — ${dateLabel}${p ? ` · ${fmtM(p.mtdPremium)} MTD` : ''}`

  const logoW = brand.logoWidth ?? 120
  const logoH = brand.logoHeight
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
  @media only screen and (max-width:480px){
    .cx-card{padding:24px 20px 28px !important;border-radius:0 !important;border-left:0 !important;border-right:0 !important;}
    .cx-outer{padding:0 !important;}
    .cx-stat{display:block !important;width:100% !important;padding:12px 0 !important;border-left:0 !important;border-top:1px solid ${C.border} !important;}
    .cx-stat-first{border-top:0 !important;}
  }
</style></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(aiSummary ? aiSummary.replace(/<[^>]+>/g, '').slice(0, 140) : `${kicker} for ${dateLabel}`)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
  <tr><td class="cx-outer" align="center" style="padding:28px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td class="cx-card" style="background:${C.paper};border:1px solid ${C.border};border-radius:14px;padding:32px 36px 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:0 0 28px;">
            <img src="${esc(brand.logoSrc)}" alt="${esc(brand.name)}" width="${logoW}"${logoH ? ` height="${logoH}"` : ''} style="display:block;width:${logoW}px;max-width:${logoW}px;height:auto;border:0;outline:none;text-decoration:none;" />
          </td></tr>
          <tr><td style="font:600 11px/1.2 ${FONT};letter-spacing:0.12em;text-transform:uppercase;color:${C.muted};">${kicker} &middot; <span style="white-space:nowrap;">${esc(dateLabel)}</span></td></tr>
          <tr><td style="padding:10px 0 0;"><h1 style="margin:0;font:500 26px/1.25 ${SERIF};color:${C.ink};">Good morning, ${esc(first)}.</h1></td></tr>
          ${aiHtml}
          ${revenueHtml}
          ${calHtml}
          ${waitingHtml}
          ${quietHtml}
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`

  // Plain-text twin: same sections, same order as the HTML.
  const textLines: string[] = [
    `${kicker} — ${dateLabel}`,
    `Good morning, ${first}.`,
    '',
  ]
  if (aiSummary) textLines.push(aiSummary.replace(/<[^>]+>/g, ''), '')
  if (p) {
    textLines.push(
      'PINNACLE REVENUE',
      `  MTD premium: ${fmtM(p.mtdPremium)}`,
      `  Same ${p.daysCompared} days last mo: ${fmtM(p.sameDaysLastMonthPremium)}`,
      `  Placement: ${Math.round(p.placementPct * 100)}%`,
      `  Pace: ${pace}`,
    )
    if (p.topTeams.length) {
      textLines.push('', 'TOP TEAMS (MTD)')
      p.topTeams.slice(0, 3).forEach((t, i) => textLines.push(`  ${i + 1}. ${t.name} — ${fmtM(t.premium)}`))
    }
    textLines.push('')
  }
  if (d.todayEvents && d.todayEvents.length) {
    textLines.push(`TODAY · ${d.todayEvents.length} ${d.todayEvents.length === 1 ? 'meeting' : 'meetings'}`)
    for (const e of d.todayEvents.slice(0, 8)) textLines.push(`  ${fmtTime(e.start, tz)}  ${e.summary || '(untitled)'}${e.conferenceLink ? ` (join: ${e.conferenceLink})` : ''}`)
    textLines.push('')
  } else if (d.todayEvents) {
    textLines.push('TODAY', '  Nothing on the calendar.', '')
  }
  if (waitingWords.length) textLines.push('WAITING ON YOU', ...waitingWords.map((w) => `  - ${w}`), '')
  if (d.quietDeals.length) {
    textLines.push('GONE QUIET')
    for (const q of d.quietDeals)
      textLines.push(`  - ${q.name}${q.company ? ` · ${q.company}` : ''}${q.value ? ` (${fmtM(q.value)})` : ''} — ${q.days}d no contact`)
  }
  const text = textLines.join('\n').trimEnd()

  return { subject, html, text }
}
