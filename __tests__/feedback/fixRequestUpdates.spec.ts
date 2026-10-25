import { describe, expect, it } from 'vitest'
import {
  FIX_REQUEST_NOTICE_PREFIX, bodyFor, fixRequestRef, noticeKey, paceAllows, parsePace, titleFor,
} from '@/lib/feedback/fixRequestUpdatesShared'
import { ALWAYS_SHOWN_PREFIXES } from '@/lib/followups/noticeActionsShared'
import { validateSettingValue } from '@/lib/settings/registryShared'

const ID = 'abcdef12-3456-7890-abcd-ef1234567890'
const now = new Date('2026-10-25T15:00:00Z')

describe('fix-request client updates', () => {
  it('only progress is paced', () => {
    for (const k of ['ack', 'started', 'done'] as const) {
      expect(paceAllows(k, 'start_done', now.toISOString(), now).ok).toBe(true)
    }
    expect(paceAllows('progress', 'start_done', null, now).ok).toBe(false)
    expect(paceAllows('progress', 'every_step', now.toISOString(), now).ok).toBe(true)
    expect(paceAllows('progress', null, now.toISOString(), now).ok).toBe(true)
  })

  it('daily allows one progress update per 24h', () => {
    const hourAgo = new Date(now.getTime() - 3600_000).toISOString()
    const dayAgo = new Date(now.getTime() - 25 * 3600_000).toISOString()
    expect(paceAllows('progress', 'daily', hourAgo, now).ok).toBe(false)
    expect(paceAllows('progress', 'daily', dayAgo, now).ok).toBe(true)
    expect(paceAllows('progress', 'daily', null, now).ok).toBe(true)
  })

  it('parses plain words', () => {
    expect(parsePace('daily')).toBe('daily')
    expect(parsePace('once a day')).toBe('daily')
    expect(parsePace('every step')).toBe('every_step')
    expect(parsePace('just when you start and when it is done')).toBe('start_done')
    expect(parsePace('every_step')).toBe('every_step')
    expect(parsePace('banana')).toBeNull()
    expect(parsePace('')).toBeNull()
  })

  it('titles use the short ref only', () => {
    expect(fixRequestRef(ID)).toBe('#ABCDEF')
    for (const k of ['ack', 'started', 'progress', 'done'] as const) {
      const t = titleFor(k, ID)
      expect(t).toContain('#ABCDEF')
      expect(t).not.toContain('export button')
    }
  })

  it('bodies: ack asks the pace once, done has a default and asks again', () => {
    expect(bodyFor('ack', null, null)).toMatch(/How do you want updates/)
    expect(bodyFor('ack', null, 'daily')).toMatch(/once a day/)
    expect(bodyFor('ack', null, 'daily')).not.toMatch(/How do you want updates/)
    expect(bodyFor('done', null, 'daily')).toMatch(/^This one's fixed\./)
    expect(bodyFor('done', 'The export button works again.', null)).toMatch(/^The export button works again\./)
    expect(bodyFor('done', null, null)).toMatch(/different pace/)
    expect(bodyFor('started', null, null)).toMatch(/started/)
  })

  it('notice keys are one per kind, progress unique, and always shown', () => {
    expect(noticeKey('started', ID, now)).toBe(`fixreq:${ID}:started`)
    expect(noticeKey('progress', ID, now)).toBe(`fixreq:${ID}:progress:${now.getTime()}`)
    expect((ALWAYS_SHOWN_PREFIXES as readonly string[]).includes(FIX_REQUEST_NOTICE_PREFIX)).toBe(true)
  })

  it('the settings registry validates the pace', () => {
    expect(validateSettingValue('notify.ticket_update_pace', 'every step')).toEqual({ ok: true, value: 'every_step' })
    expect(validateSettingValue('notify.ticket_update_pace', 'nope').ok).toBe(false)
  })
})
