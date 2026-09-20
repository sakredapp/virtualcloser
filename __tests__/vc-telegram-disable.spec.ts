import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Populate BOTH tokens, exactly like production: the VC token stays set
// because the other CRM's tooling reads it. The disable must hold anyway.
process.env.TELEGRAM_BOT_TOKEN = 'VC-TOKEN-SHOULD-NEVER-BE-USED'
process.env.TELEGRAM_BOT_USERNAME = 'VirtualCloserBot'
process.env.CXO_TELEGRAM_BOT_TOKEN = 'CXO-TOKEN'
process.env.CXO_TELEGRAM_BOT_USERNAME = 'SuiteCxObot'

import { brandTelegramToken, brandTelegramEnabled, DEFAULT_TELEGRAM_BRAND } from '@/lib/brand'
import { resolveTelegramToken, sendTelegramMessage, telegramBotUsername } from '@/lib/telegram'
import { runWithBrand } from '@/lib/telegram-context'

describe('VC bot is disabled in this codebase', () => {
  it('resolves no token for virtualcloser even though the env var is set', () => {
    expect(process.env.TELEGRAM_BOT_TOKEN).toBeTruthy()
    expect(brandTelegramEnabled('virtualcloser')).toBe(false)
    expect(brandTelegramToken('virtualcloser')).toBeUndefined()
  })

  it('still resolves the CXO token', () => {
    expect(brandTelegramEnabled('cxo')).toBe(true)
    expect(brandTelegramToken('cxo')).toBe('CXO-TOKEN')
  })

  it('defaults to CXO when no brand is supplied', () => {
    expect(DEFAULT_TELEGRAM_BRAND).toBe('cxo')
    expect(resolveTelegramToken()).toBe('CXO-TOKEN')
    expect(telegramBotUsername()).toBe('SuiteCxObot')
  })

  it('resolves the VC token to undefined inside a VC brand context', async () => {
    await runWithBrand('virtualcloser', async () => {
      expect(resolveTelegramToken()).toBeUndefined()
    })
  })
})

describe('senders no-op rather than transmit as the VC bot', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })))
    vi.stubGlobal('fetch', fetchSpy)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sends NOTHING over the wire for an explicit VC brand', async () => {
    const res = await sendTelegramMessage(123, 'hello', { brand: 'virtualcloser' })
    expect(res.ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends NOTHING over the wire inside a VC brand context', async () => {
    await runWithBrand('virtualcloser', async () => {
      const res = await sendTelegramMessage(123, 'hello')
      expect(res.ok).toBe(false)
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does send for CXO, and hits the CXO token URL', async () => {
    const res = await sendTelegramMessage(123, 'hello', { brand: 'cxo' })
    expect(res.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('CXO-TOKEN')
    expect(url).not.toContain('VC-TOKEN-SHOULD-NEVER-BE-USED')
  })

  it('an unscoped send defaults to the CXO bot', async () => {
    await sendTelegramMessage(123, 'hello')
    expect(String(fetchSpy.mock.calls[0][0])).toContain('CXO-TOKEN')
  })
})
