import { afterEach, describe, expect, it } from 'vitest'
import {
  extractClassificationJson,
  isTransient,
  plaudAgentOn,
  plaudAgentScope,
} from '@/lib/plaud/agentTick'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ORIGINAL_ENV = process.env.PLAUD_AGENT_REP_IDS

afterEach(() => {
  // Restore to whatever the host had — never leak test mutations.
  if (ORIGINAL_ENV === undefined) delete process.env.PLAUD_AGENT_REP_IDS
  else process.env.PLAUD_AGENT_REP_IDS = ORIGINAL_ENV
})

describe('plaudAgentScope (on by default for Suite CXO)', () => {
  it('unset or blank means every Suite CXO tenant', () => {
    expect(plaudAgentScope(undefined)).toBe('cxo')
    expect(plaudAgentScope('  ')).toBe('cxo')
    expect(plaudAgentOn(undefined)).toBe(true)
  })

  it('off is the kill switch', () => {
    expect(plaudAgentScope('off')).toBe('off')
    expect(plaudAgentScope(' OFF ')).toBe('off')
    expect(plaudAgentOn('off')).toBe(false)
  })

  it('"*" means no filter', () => {
    expect(plaudAgentScope('*')).toBe('all')
  })

  it('parses comma-separated ids, trims, drops empty tokens', () => {
    const s = plaudAgentScope('rep_a, rep_b ,,  rep_c,')
    expect(s).toBeInstanceOf(Set)
    expect(Array.from(s as Set<string>)).toEqual(['rep_a', 'rep_b', 'rep_c'])
  })

  it('the worker no longer requires the env var to run the ticks', () => {
    const src = readFileSync(join(__dirname, '../../hetzner-worker/index.ts'), 'utf8')
    expect(src).not.toContain('Boolean(process.env.PLAUD_AGENT_REP_IDS)')
    expect(src.match(/plaudAgentOn\(\) &&/g)?.length).toBe(2)
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
