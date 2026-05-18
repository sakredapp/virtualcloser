import { afterEach, describe, expect, it } from 'vitest'
import {
  extractClassificationJson,
  isTransient,
  plaudAgentEnabledReps,
} from '@/lib/plaud/agentTick'

const ORIGINAL_ENV = process.env.PLAUD_AGENT_REP_IDS

afterEach(() => {
  // Restore to whatever the host had — never leak test mutations.
  if (ORIGINAL_ENV === undefined) delete process.env.PLAUD_AGENT_REP_IDS
  else process.env.PLAUD_AGENT_REP_IDS = ORIGINAL_ENV
})

describe('plaudAgentEnabledReps', () => {
  it('returns a never-matching sentinel set when env var is unset', () => {
    delete process.env.PLAUD_AGENT_REP_IDS
    const set = plaudAgentEnabledReps()
    expect(set).not.toBeNull()
    expect(set!.has('rep_spence')).toBe(false)
    expect(set!.has('__off__')).toBe(true)
  })

  it('returns null (no filter) for wildcard "*"', () => {
    process.env.PLAUD_AGENT_REP_IDS = '*'
    expect(plaudAgentEnabledReps()).toBeNull()
  })

  it('parses comma-separated ids and trims whitespace', () => {
    process.env.PLAUD_AGENT_REP_IDS = 'rep_a, rep_b ,  rep_c'
    const set = plaudAgentEnabledReps()
    expect(set).not.toBeNull()
    expect(set!.has('rep_a')).toBe(true)
    expect(set!.has('rep_b')).toBe(true)
    expect(set!.has('rep_c')).toBe(true)
    expect(set!.size).toBe(3)
  })

  it('drops empty tokens (handles trailing commas)', () => {
    process.env.PLAUD_AGENT_REP_IDS = 'rep_a,,rep_b,'
    const set = plaudAgentEnabledReps()
    expect(set!.size).toBe(2)
  })
})

describe('extractClassificationJson', () => {
  it('parses a valid trailing JSON line', () => {
    const text = 'Some reasoning prose.\n{"triage_class":"action","reasoning":"sales call"}'
    expect(extractClassificationJson(text)).toEqual({
      triage_class: 'action',
      reasoning: 'sales call',
    })
  })

  it('accepts every valid class', () => {
    for (const cls of ['trash', 'action', 'training', 'executive', 'unclear']) {
      const r = extractClassificationJson(`{"triage_class":"${cls}","reasoning":"x"}`)
      expect(r?.triage_class).toBe(cls)
    }
  })

  it('returns null for an unknown class string', () => {
    expect(extractClassificationJson('{"triage_class":"bogus","reasoning":"x"}')).toBeNull()
  })

  it('returns null when no JSON-shaped block is present', () => {
    expect(extractClassificationJson('Just words about a meeting.')).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    expect(extractClassificationJson('{"triage_class":"action", reasoning:}')).toBeNull()
  })

  it('truncates reasoning to 500 chars', () => {
    const long = 'x'.repeat(800)
    const r = extractClassificationJson(`{"triage_class":"action","reasoning":"${long}"}`)
    expect(r?.reasoning.length).toBe(500)
  })
})

describe('isTransient', () => {
  it('identifies rate-limit phrasing as transient', () => {
    expect(isTransient(new Error('Drive rate-limited — will retry on next tick'))).toBe(true)
    expect(isTransient(new Error('429 rate limit exceeded'))).toBe(true)
  })

  it('identifies common network-error codes as transient', () => {
    expect(isTransient(new Error('ECONNRESET'))).toBe(true)
    expect(isTransient(new Error('ETIMEDOUT'))).toBe(true)
    expect(isTransient(new Error('ECONNREFUSED'))).toBe(true)
    expect(isTransient(new Error('fetch failed'))).toBe(true)
    expect(isTransient(new Error('socket hang up'))).toBe(true)
  })

  it('identifies HTTP 5xx in error text as transient', () => {
    expect(isTransient(new Error('Drive Doc create failed (status 503)'))).toBe(true)
    expect(isTransient(new Error('gmail send failed: 502 Bad Gateway'))).toBe(true)
  })

  it('does NOT treat auth / validation errors as transient', () => {
    expect(isTransient(new Error('Google Drive scope not granted — reconnect Google in Integrations'))).toBe(false)
    expect(isTransient(new Error('create_task missing content'))).toBe(false)
    expect(isTransient(new Error('rep has no Google Sheet CRM linked'))).toBe(false)
    expect(isTransient(new Error('Google authorization expired — reconnect Google in Integrations'))).toBe(false)
  })

  it('handles non-Error throwables', () => {
    expect(isTransient('ECONNRESET')).toBe(true)
    expect(isTransient(null)).toBe(false)
    expect(isTransient(undefined)).toBe(false)
  })
})
