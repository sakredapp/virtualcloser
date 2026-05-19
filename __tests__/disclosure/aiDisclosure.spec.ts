import { describe, expect, it } from 'vitest'
import {
  alreadyDisclosesAi,
  ensureAiDisclosure,
} from '@/lib/sms/aiEngine'
import { HEALTH_INSURANCE_DEFAULT_VARIABLES } from '@/lib/voice/healthInsuranceAgent'

// These tests encode a policy invariant — every first-touch outbound from an
// AI agent must identify as AI. They are intentionally strict so a future
// edit that silently drops disclosure (e.g. trimming a template variable)
// fails CI rather than ships.

describe('alreadyDisclosesAi', () => {
  it('detects common explicit phrasings', () => {
    expect(alreadyDisclosesAi("Hey, I'm an AI assistant from Sacred Health")).toBe(true)
    expect(alreadyDisclosesAi('This is an AI agent reaching out')).toBe(true)
    expect(alreadyDisclosesAi('Heads up — this is an automated message')).toBe(true)
    expect(alreadyDisclosesAi('I am a bot, here to help schedule')).toBe(true)
    expect(alreadyDisclosesAi("I'm an AI scheduler")).toBe(true)
  })

  it('does NOT false-positive on innocent uses of similar words', () => {
    expect(alreadyDisclosesAi('We can offer assistance with your claim')).toBe(false)
    expect(alreadyDisclosesAi('Our customer service team is automated for after-hours')).toBe(false)
    expect(alreadyDisclosesAi("Hey, this is Rachel from Sacred Health")).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(alreadyDisclosesAi('I AM AN AI assistant')).toBe(true)
    expect(alreadyDisclosesAi('this is a BOT')).toBe(true)
  })
})

describe('ensureAiDisclosure', () => {
  it('prepends disclosure when missing', () => {
    const out = ensureAiDisclosure('Hey Sarah, this is Rachel — got a sec?', 'Rachel')
    expect(out.toLowerCase()).toMatch(/ai assistant/)
    expect(out).toContain('Hey Sarah')
  })

  it('does NOT double-disclose if the message already discloses', () => {
    const original = "Hey Sarah, I'm an AI assistant from Sacred Health — got a sec?"
    expect(ensureAiDisclosure(original, 'Rachel')).toBe(original)
  })

  it('is idempotent — running twice yields the same string', () => {
    const original = 'Hi! This is Rachel from Sacred Health.'
    const once = ensureAiDisclosure(original, 'Rachel')
    const twice = ensureAiDisclosure(once, 'Rachel')
    expect(twice).toBe(once)
  })

  it('uses the agent name in the prepended disclosure', () => {
    const out = ensureAiDisclosure('Some message body', 'Jordan')
    expect(out).toContain('Jordan')
  })
})

describe('voice opener default (HEALTH_INSURANCE_DEFAULT_VARIABLES.ca_opener)', () => {
  it('always includes the AI disclosure marker', () => {
    const opener = HEALTH_INSURANCE_DEFAULT_VARIABLES.ca_opener
    expect(opener.toLowerCase()).toMatch(/ai assistant/)
  })

  it('always includes the call-recording notice', () => {
    const opener = HEALTH_INSURANCE_DEFAULT_VARIABLES.ca_opener
    expect(opener.toLowerCase()).toMatch(/recorded/)
  })
})
