/**
 * Ciao settings confirm: the three fixes after PR #129 (QA 2026-10-23).
 *  1. Ciao never writes its own confirmation: the prompt rule exists and the
 *     post-check spots a hand-written confirm (runAgent gives one corrective turn).
 *  2. "Back to the default" for people.can_view_comp saves default (null), never off.
 *  3. The confirm card reads plain words, not "value: true, target: ...".
 * Pure: no model, no database. Made-up people only.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => { throw new Error('no db in this spec') } } }))

import { CONFIRM_GATE_RULES, HAND_WRITTEN_CONFIRM_NOTE, HAND_WRITTEN_CONFIRM_RULE, looksLikeHandWrittenConfirm, proposalText } from '@/lib/agent/confirmGateShared'
import { describeSettingChange, displayValue, findEntry, meansDefault, validateSettingValue } from '@/lib/settings/registryShared'
import { describeRegistryCall } from '@/lib/settings/registry'
import { SETTINGS_TOOL_DEFS } from '@/lib/agent/settingsTools'

describe('fix 1: Ciao never writes the confirmation itself', () => {
  it('the gate rules tell Ciao to call the tool and let the app ask', () => {
    expect(CONFIRM_GATE_RULES).toContain(HAND_WRITTEN_CONFIRM_RULE)
    expect(HAND_WRITTEN_CONFIRM_RULE).toMatch(/never write the confirmation yourself/i)
    expect(HAND_WRITTEN_CONFIRM_RULE).toMatch(/call the tool/i)
    expect(HAND_WRITTEN_CONFIRM_RULE).toMatch(/pay/i)
  })

  it('the corrective note is hidden from the person and asks for the tool call', () => {
    expect(HAND_WRITTEN_CONFIRM_NOTE).toMatch(/never sees/i)
    expect(HAND_WRITTEN_CONFIRM_NOTE).toMatch(/change_setting/)
  })

  it.each([
    'Here is what I will do. Nothing is done yet:\n\nLet Jordan Ellis see pay and bonuses.\n\nReply yes to go ahead, or tell me what to change.',
    '⚠️ Here’s what I will do: put Jordan back on the default pay access. Reply yes to confirm.',
    'I will let Jordan Ellis see pay and bonuses. Nothing is changed until you confirm. Shall I go ahead?',
    'Nothing has been saved yet. Say "yes" and I will make the change.',
  ])('spots a hand-written confirm: %s', (t) => {
    expect(looksLikeHandWrittenConfirm(t)).toBe(true)
  })

  it.each([
    '',
    'Done. Jordan Ellis can see pay now.',
    'Your time zone is America/Chicago.',
    'Which Jordan do you mean: Jordan Ellis or Jordan Park?',
    'Nothing has been saved yet and it is not on Today. Want me to add it?',
    'Yes, Jordan can see pay and bonuses today.',
  ])('leaves an ordinary reply alone: %s', (t) => {
    expect(looksLikeHandWrittenConfirm(t)).toBe(false)
  })

  it("the app's own proposal text matches (so a copy of it is caught), which is why the check only runs when no tool proposed", () => {
    const text = proposalText([{ kind: 'tool', tool: 'change_setting', args: {}, summary: 'Let Jordan Ellis see pay and bonuses.' }])
    expect(looksLikeHandWrittenConfirm(text)).toBe(true)
  })
})

describe('fix 2: "back to the default" is default (null), never off', () => {
  it.each(['default', 'Default', 'reset', 'clear', 'back to default', 'back to the default', 'Back to the default.', 'set it back to the default', 'put them back on the default', 'back to normal', 'the usual', 'remove the override', null])(
    '%s saves null',
    (v) => {
      expect(validateSettingValue('people.can_view_comp', v)).toEqual({ ok: true, value: null })
    },
  )

  it.each([
    ['allow', true],
    ['yes', true],
    [true, true],
    ['deny', false],
    ['off', false],
    [false, false],
  ] as const)('%s still saves %s', (v, want) => {
    expect(validateSettingValue('people.can_view_comp', v)).toEqual({ ok: true, value: want })
  })

  it('meansDefault does not swallow ordinary words', () => {
    expect(meansDefault('off')).toBe(false)
    expect(meansDefault('deny')).toBe(false)
    expect(meansDefault('default pay for sales')).toBe(false)
    expect(meansDefault(false)).toBe(false)
  })

  it('the tool description and the entry tell the model to send "default", never "off"', () => {
    const def = SETTINGS_TOOL_DEFS.find((t) => t.name === 'change_setting')!
    const desc = String((def.input_schema as { properties: { value: { description: string } } }).properties.value.description)
    expect(desc).toMatch(/back to the default/i)
    expect(desc).toContain('send "default", never "off"')
    expect(findEntry('people.can_view_comp')?.inputs).toMatch(/never "off"/)
  })
})

describe('fix 3: the confirm card reads plain words', () => {
  const comp = findEntry('people.can_view_comp')!

  it('pay access: let, stop, back to default', () => {
    expect(describeSettingChange(comp, true, 'Jordan Ellis')).toBe('Let Jordan Ellis see pay and bonuses')
    expect(describeSettingChange(comp, 'allow', 'Jordan Ellis')).toBe('Let Jordan Ellis see pay and bonuses')
    expect(describeSettingChange(comp, false, 'Jordan Ellis')).toBe('Stop Jordan Ellis seeing pay and bonuses')
    expect(describeSettingChange(comp, 'deny', 'Jordan Ellis')).toBe('Stop Jordan Ellis seeing pay and bonuses')
    expect(describeSettingChange(comp, 'back to the default', 'Jordan Ellis')).toMatch(/^Put Jordan Ellis back on the default for pay and bonuses/)
  })

  it('the gate card has no raw values and keeps the reason line', () => {
    const lines = describeRegistryCall('change_setting', { key: 'people.can_view_comp', value: true, target: 'jordan' }, { targetName: 'Jordan Ellis' })!
    expect(lines[0]).toBe('Let Jordan Ellis see pay and bonuses.')
    expect(lines.join(' ')).not.toMatch(/value:|target:|true|null/)
    expect(lines[1]).toMatch(/^Why I am checking: /)
  })

  it('any other setting reads from its label and plain values', () => {
    expect(describeSettingChange(findEntry('reminders.email')!, true)).toBe('Turn on: Due-date reminders by email')
    expect(describeSettingChange(findEntry('reminders.email')!, 'off')).toBe('Turn off: Due-date reminders by email')
    expect(describeSettingChange(findEntry('profile.timezone')!, 'America/Chicago')).toBe('Set Your time zone to America/Chicago')
    expect(describeSettingChange(findEntry('company.values')!, ['Care', 'Speed'])).toBe('Set Company values to Care, Speed')
    expect(describeSettingChange(findEntry('schedule.work_hours')!, { start: 8, end: 17, days: [1, 2, 3, 4, 5] })).toBe('Set Your working hours to start 8, end 17, days 1, 2, 3, 4, 5')
  })

  it('an action card shows its inputs without JSON', () => {
    const lines = describeRegistryCall('do_action', { key: 'team.co_admin.invite', input: { email: 'pat@example.test', name: 'Pat Test' } })!
    expect(lines[0]).toMatch(/pat@example\.test/)
    expect(lines[0]).not.toMatch(/[{}"]/)
  })

  it('displayValue never shows true/false/null', () => {
    expect(displayValue(true)).toBe('on')
    expect(displayValue(false)).toBe('off')
    expect(displayValue(null)).toBe('nothing')
  })
})
