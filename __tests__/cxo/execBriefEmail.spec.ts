import { describe, it, expect } from 'vitest'
import { renderExecEmail, cxoEmailBrand } from '@/lib/exec/emailDigest'
import { renderDueDigest } from '@/lib/dueDigestEmail'
import { getBrand } from '@/lib/brand'

// Fake sample data only. Never real Pinnacle numbers.
const digest = {
  pendingDrafts: 2,
  unansweredThreads: 1,
  quietDeals: [{ name: 'Sample & Co', company: 'Example', value: 120000, days: 12 }],
  todayEvents: [{ summary: 'Leadership sync', start: '2026-10-20T13:00:00Z', conferenceLink: 'https://meet.example.com/x' }],
  topLeads: [],
  overnightChanges: 0,
}
const pinnacle = {
  mtdPremium: 4_200_000,
  sameDaysLastMonthPremium: 5_250_000,
  daysCompared: 20,
  vsLastMonthPct: -0.2,
  dataThrough: '2026-10-20',
  placementPct: 0.71,
  topTeams: [{ name: 'Team Alpha', premium: 1_100_000 }],
}

function render() {
  return renderExecEmail({
    digest,
    pinnacle,
    aiSummary: 'A calm summary.',
    name: 'Alex Sample',
    timezone: 'America/New_York',
    mode: 'daily',
    brand: cxoEmailBrand(),
  } as never)
}

describe('Suite CXO morning brief email', () => {
  it('header is the real logo image only, as a hosted PNG', () => {
    const { html } = render()
    const logo = getBrand('cxo').logo.emailSrc!
    expect(logo.src).toMatch(/^https:\/\/.+\.png$/)
    expect(html).toContain(`src="${logo.src}"`)
    expect(html).toContain('alt="Suite CXO"')
    // No typed brand name / text logo anywhere in the visible header.
    expect(html).not.toMatch(/>\s*Suite CXO\s*</)
    expect(html).not.toMatch(/>\s*CXO\s*</)
    expect(html).not.toMatch(/>\s*suite\s*</i)
  })

  it('keeps every data point and drops the green/red status colors', () => {
    const { html, text, subject } = render()
    expect(subject).toBe(`Morning brief — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' })} · $4.2M MTD`)
    for (const s of ['$4.2M', '$5.3M', '71%', 'down 20%', 'Team Alpha', '$1.1M', 'Leadership sync', 'email drafts to approve']) {
      expect(html).toContain(s)
    }
    expect(html).not.toMatch(/#16a34a|#c21a00|#2563eb/i)
    // Plain-text twin carries the same sections.
    for (const s of ['PINNACLE REVENUE', 'Same 20 days last mo: $5.3M', 'TOP TEAMS (MTD)', 'TODAY', 'WAITING ON YOU']) {
      expect(text).toContain(s)
    }
  })

  it('stat row is three equal-width cells that stack on mobile', () => {
    const { html } = render()
    expect(html.match(/class="cx-stat[^"]*" width="33%"/g)?.length).toBe(3)
    expect(html).toContain('@media only screen and (max-width:480px)')
  })
})

describe('Suite CXO morning brief: edge cases', () => {
  const emptyDigest = { pendingDrafts: 0, unansweredThreads: 0, quietDeals: [], todayEvents: undefined, topLeads: [], overnightChanges: 0 }
  const base = { name: 'Alex Sample', timezone: 'America/New_York', mode: 'daily', brand: cxoEmailBrand() }

  it('escapes the AI summary in HTML and keeps it whole in the plain text', () => {
    const aiSummary = 'Placement is <5% of goal & R&D <b>needs</b> you.'
    const { html, text } = renderExecEmail({ ...base, digest: emptyDigest, pinnacle: null, aiSummary } as never)
    expect(html).toContain('Placement is &lt;5% of goal &amp; R&amp;D &lt;b&gt;needs&lt;/b&gt; you.')
    expect(html).not.toContain('<b>needs</b>')
    expect(text).toContain(aiSummary)
  })

  it('hides every empty section and prints no junk', () => {
    const { html, text } = renderExecEmail({ ...base, digest: emptyDigest, pinnacle: null, aiSummary: '' } as never)
    for (const s of ['Pinnacle revenue', 'Waiting on you', 'Gone quiet', '>Today', 'class="cx-stat']) expect(html).not.toContain(s)
    expect(`${html}${text}`).not.toMatch(/undefined|NaN|null/)
    expect(text.trim().split('\n').length).toBe(2)
  })

  it('says which side of the pace is missing, never "Same 0 days"', () => {
    const pin = { mtdPremium: 900_000, sameDaysLastMonthPremium: 0, daysCompared: 12, vsLastMonthPct: null, dataThrough: '2026-10-12', placementPct: 0.5, topTeams: [] }
    const a = renderExecEmail({ ...base, digest: emptyDigest, pinnacle: pin, aiSummary: '' } as never)
    expect(a.html).toContain('no data for the same days last month')
    expect(a.html).not.toContain('Top teams')
    const b = renderExecEmail({ ...base, digest: emptyDigest, pinnacle: { ...pin, daysCompared: 0 }, aiSummary: '' } as never)
    expect(b.html).toContain('no days to compare yet')
    expect(`${b.html}${b.text}`).not.toContain('Same 0 days')
    expect(b.text).toContain('Same days last mo: $0')
  })
})

describe('Suite CXO due-soon email', () => {
  it('uses the real logo image, no "Suite CXO" text eyebrow', () => {
    const { html } = renderDueDigest({ firstName: 'Alex', items: [], boardsUrl: 'https://x.example', settingsUrl: 'https://y.example' })
    expect(html).toContain(getBrand('cxo').logo.emailSrc!.src)
    expect(html).not.toContain('Suite CXO &middot;')
  })
})

describe('Suite CXO email logo: white in dark mode (owner 2026-10-20)', () => {
  const logo = getBrand('cxo').logo.emailSrc!
  const due = () =>
    renderDueDigest({
      firstName: 'Alex',
      items: [{ title: 'Deck', board: 'Leadership', due_date: '2026-10-21', days_left: 1, url: 'https://x.suitecxo.com/c/1' }],
      boardsUrl: 'https://x.suitecxo.com/boards',
      settingsUrl: 'https://x.suitecxo.com/settings',
    }).html

  it('has a white logo PNG of the same size next to the light one', () => {
    expect(logo.darkSrc).toBe('https://www.suitecxo.com/brands/cxo-logo-email-white.png')
  })

  it('brief, due digest and shared shell carry both logos, light shown, white swapped in only in dark mode', async () => {
    const { loginLinkInviteEmail } = await import('@/lib/email')
    const shellHtml = loginLinkInviteEmail({
      toEmail: 'jane@example.test',
      displayName: 'Jane Doe',
      workspaceLabel: 'Acme',
      role: 'member',
      setUrl: 'https://acme.suitecxo.com/set',
      expiresLabel: 'Oct 27, 2026',
      brand: 'cxo',
    } as never).html
    for (const html of [render().html, due(), shellHtml]) {
      expect(html).toContain(`class="cx-logo-light" src="${logo.src}"`)
      expect(html).toContain(`src="${logo.darkSrc}"`)
      // White logo hidden by default and from Outlook desktop.
      expect(html).toMatch(/<!--\[if !mso\]><!--><div class="cx-logo-dark" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">/)
      expect(html).toContain('@media (prefers-color-scheme: dark)')
      expect(html).toContain('[data-ogsc] .cx-logo-dark')
      expect(html).toContain('<meta name="color-scheme" content="light dark">')
      // Still no typed brand text.
      expect(html).not.toMatch(/>\s*Suite CXO\s*</)
    }
  })

  it('wherever the white logo shows on a card, the card goes dark in the same rule set', () => {
    for (const html of [render().html, due()]) {
      const media = html.slice(html.indexOf('@media (prefers-color-scheme: dark)'))
      expect(media).toMatch(/\.cx-card\{background:#1A1B1E !important;/)
      expect(html).toMatch(/\[data-ogsc\] \.cx-card,\[data-ogsb\] \.cx-card\{background:#1A1B1E !important;/)
      expect(html).toMatch(/class="cx-card"/)
    }
  })

  it('Virtual Closer emails are unchanged: no dark logo, no swap CSS', async () => {
    const E = await import('@/lib/email')
    const vc = [
      E.welcomeEmail({ toEmail: 'j@example.test', displayName: 'Jane Doe', slug: 'acme', password: 'pw', tierLabel: 'Individual' } as never).html,
      E.passwordResetEmail({ toEmail: 'j@example.test', displayName: 'Jane', resetUrl: 'https://example.test/r' }).html,
      E.featureRequestEmail({ fromName: 'Ann', fromEmail: null, workspace: 'Acme', summary: 'X', brand: 'virtualcloser' } as never).html,
    ]
    for (const html of vc) {
      expect(html).not.toContain('cx-logo')
      expect(html).not.toContain('prefers-color-scheme')
      expect(html).not.toContain('data-ogsc')
      expect(html).not.toContain('color-scheme')
      expect(html).not.toContain('suitecxo.com')
    }
  })
})

describe('Suite CXO morning brief: Ciao notices ride in the email', () => {
  const host = 'https://acme.suitecxo.com'
  const twoNotices = [
    { title: 'Day wrap: 2 to-dos slipped', body: 'Deck for the board is 1 day late.', href: `${host}/dashboard` },
    { title: 'A number slipped: placement', body: null, href: `${host}/dashboard/numbers` },
  ]
  const renderWith = (notices: Array<{ title: string; body?: string | null; href: string }>, assistantName?: string) =>
    renderExecEmail({
      digest,
      pinnacle: null,
      aiSummary: '',
      name: 'Alex Sample',
      timezone: 'America/New_York',
      mode: 'daily',
      brand: cxoEmailBrand(),
      notices,
      assistantName,
    } as never)

  it('renders a "From Ciao" section with 2 notices, each title linking to the member host', () => {
    const { html } = renderWith(twoNotices)
    expect(html).toContain('From Ciao')
    expect(html).toContain(`href="${host}/dashboard"`)
    expect(html).toContain(`href="${host}/dashboard/numbers"`)
    expect(html).toContain('Day wrap: 2 to-dos slipped')
    expect(html).toContain('Deck for the board is 1 day late.')
    expect(html).toContain('A number slipped: placement')
    // Near the top: before the calendar.
    expect(html.indexOf('From Ciao')).toBeLessThan(html.indexOf('Leadership sync'))
  })

  it("uses the member's own assistant name", () => {
    expect(renderWith(twoNotices, 'Chow').html).toContain('From Chow')
  })

  it('escapes a notice title containing <b>&', () => {
    const { html, text } = renderWith([{ title: 'Raise <b>& bonus</b>', body: 'R&D <i>now</i>', href: `${host}/x?a=1&b=2` }])
    expect(html).toContain('Raise &lt;b&gt;&amp; bonus&lt;/b&gt;')
    expect(html).not.toContain('<b>& bonus</b>')
    expect(html).toContain('R&amp;D &lt;i&gt;now&lt;/i&gt;')
    expect(html).toContain(`href="${host}/x?a=1&amp;b=2"`)
    expect(text).toContain('Raise <b>& bonus</b>')
  })

  it('leaves the section out entirely when there are no notices', () => {
    for (const r of [renderWith([]), render()]) {
      expect(r.html).not.toContain('From Ciao')
      expect(r.text).not.toContain('FROM CIAO')
      expect(`${r.html}${r.text}`).not.toMatch(/0 notices/i)
    }
  })

  it('shows at most 5 notices', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ title: `Notice ${i + 1}`, href: `${host}/n/${i + 1}` }))
    const { html, text } = renderWith(many)
    expect(html).toContain('Notice 5')
    expect(html).not.toContain('Notice 6')
    expect(text).not.toContain('Notice 6')
  })

  it('the plain-text twin carries each notice and its link', () => {
    const { text } = renderWith(twoNotices)
    expect(text).toContain('FROM CIAO')
    expect(text).toContain('Day wrap: 2 to-dos slipped')
    expect(text).toContain(`${host}/dashboard`)
    expect(text).toContain(`${host}/dashboard/numbers`)
  })

  it('has no "deals gone quiet" on the CXO brand', () => {
    const { html, text } = renderWith(twoNotices)
    for (const s of ['gone quiet', 'Gone quiet', 'no contact', 'Sample &amp; Co']) expect(html).not.toContain(s)
    for (const s of ['GONE QUIET', 'gone quiet', 'Sample & Co']) expect(text).not.toContain(s)
  })

  it('a non-CXO brand still shows the quiet deals', () => {
    const { html } = renderExecEmail({
      digest,
      pinnacle: null,
      aiSummary: '',
      name: 'Alex Sample',
      timezone: 'America/New_York',
      mode: 'daily',
      brand: { name: 'Example', logoSrc: 'https://example.test/logo.png', accent: '#000000' },
    } as never)
    expect(html).toContain('12d no contact')
    expect(html).toContain('deal gone quiet')
  })
})
