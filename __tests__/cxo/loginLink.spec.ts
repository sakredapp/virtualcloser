import { describe, expect, it } from 'vitest'
import {
  LOGIN_LINK_TTL_MS,
  loginLinkExpiresLabel,
  loginLinkUrl,
  pickLoginLinkToken,
} from '@/lib/loginLink'
import { loginLinkInviteEmail } from '@/lib/email'

const NOW = Date.parse('2026-10-09T15:00:00Z')
const TOKEN = 'a'.repeat(64)
const FRESH = 'b'.repeat(64)
const mint = () => FRESH

describe('pickLoginLinkToken — reuse a live link, else mint a 7-day one', () => {
  it('reuses an existing link with more than a day left', () => {
    const r = pickLoginLinkToken({ token: TOKEN, expiresAt: '2026-10-16T15:00:00Z' }, NOW, mint)
    expect(r).toEqual({ token: TOKEN, expiresAt: '2026-10-16T15:00:00.000Z', reused: true })
  })

  it('mints fresh when the link has under a day left', () => {
    const r = pickLoginLinkToken({ token: TOKEN, expiresAt: '2026-10-10T10:00:00Z' }, NOW, mint)
    expect(r.reused).toBe(false)
    expect(r.token).toBe(FRESH)
    expect(Date.parse(r.expiresAt) - NOW).toBe(LOGIN_LINK_TTL_MS)
  })

  it('mints fresh when there is no link, it expired, or it is malformed', () => {
    expect(pickLoginLinkToken({ token: null, expiresAt: null }, NOW, mint).reused).toBe(false)
    expect(pickLoginLinkToken({ token: TOKEN, expiresAt: '2026-10-01T00:00:00Z' }, NOW, mint).reused).toBe(false)
    expect(pickLoginLinkToken({ token: 'short', expiresAt: '2026-10-16T00:00:00Z' }, NOW, mint).reused).toBe(false)
    expect(pickLoginLinkToken({ token: TOKEN, expiresAt: null }, NOW, mint).reused).toBe(false)
  })

  it('builds the brand reset URL and a plain date label', () => {
    expect(loginLinkUrl('suitecxo.com', TOKEN)).toBe(`https://suitecxo.com/reset-password?token=${TOKEN}`)
    expect(loginLinkExpiresLabel('2026-10-16T15:00:00Z')).toBe('Oct 16, 2026')
  })
})

describe('loginLinkInviteEmail — a link, never a password, never Telegram', () => {
  const setUrl = loginLinkUrl('suitecxo.com', TOKEN)
  const tpl = loginLinkInviteEmail({
    toEmail: 'exec@example.com',
    displayName: 'Pat Example',
    workspaceLabel: 'Example Group',
    role: 'owner',
    setUrl,
    expiresLabel: 'Oct 16, 2026',
    brand: 'cxo',
  })

  it('says the login is ready, with one set-password button to the link', () => {
    expect(tpl.subject).toBe('Your CXO Suite login is ready')
    expect(tpl.html).toContain('Your login is ready')
    expect(tpl.html).toContain('Set your password →')
    expect(tpl.html).toContain(`href="${setUrl}"`)
    expect(tpl.text).toContain(setUrl)
    expect(tpl.html).toContain('Oct 16, 2026')
  })

  it('points at the brand login with their email', () => {
    expect(tpl.html).toContain('https://suitecxo.com/login')
    expect(tpl.html).toContain('exec@example.com')
    expect(tpl.text).toContain('https://suitecxo.com/login with exec@example.com')
  })

  it('uses CXO tokens, not VC red', () => {
    expect(tpl.html).toContain('#2A2A2A')
    expect(tpl.html.toLowerCase()).not.toContain('#ff2800')
  })

  it('has no password and no Telegram', () => {
    for (const body of [tpl.html, tpl.text]) {
      expect(body.toLowerCase()).not.toContain('password:')
      expect(body.toLowerCase()).not.toContain('telegram')
      expect(body).not.toContain('t.me/')
    }
  })
})
