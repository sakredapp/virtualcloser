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
    for (const s of ['$4.2M', '$5.3M', '71%', 'down 20%', 'Team Alpha', '$1.1M', 'Leadership sync', 'email drafts to approve', '12d no contact', 'Sample &amp; Co']) {
      expect(html).toContain(s)
    }
    expect(html).not.toMatch(/#16a34a|#c21a00|#2563eb/i)
    // Plain-text twin carries the same sections.
    for (const s of ['PINNACLE REVENUE', 'Same 20 days last mo: $5.3M', 'TOP TEAMS (MTD)', 'TODAY', 'WAITING ON YOU', 'GONE QUIET', 'Sample & Co']) {
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
