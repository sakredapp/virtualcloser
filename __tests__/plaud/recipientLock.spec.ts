// Guards the contract that app/api/plaud/actions/[id]/edit/route.ts depends
// on to lock the recipient of a resolved people-touching action.
//
// If a future refactor accidentally drops `send_email` or
// `create_calendar_event` from PEOPLE_TOUCHING_KINDS, the edit route's lock
// will silently stop engaging — and an approver could send a vetted email
// to a different address than what the UI displayed. This test fails fast
// before that ships.

import { describe, expect, it } from 'vitest'
import {
  PEOPLE_TOUCHING_KINDS,
  PLAUD_TOOL_NAMES,
  type PlaudActionKind,
} from '@/lib/plaud/agentTools'

describe('PEOPLE_TOUCHING_KINDS', () => {
  it('includes send_email — required for edit-route recipient lock', () => {
    expect(PEOPLE_TOUCHING_KINDS.has('send_email')).toBe(true)
  })

  it('includes create_calendar_event — required for edit-route recipient lock', () => {
    expect(PEOPLE_TOUCHING_KINDS.has('create_calendar_event')).toBe(true)
  })

  it('does NOT include safe auto-execute kinds', () => {
    const autoExecute: PlaudActionKind[] = [
      'create_task',
      'create_doc',
      'update_sheet',
      'notify_member',
    ]
    for (const kind of autoExecute) {
      expect(PEOPLE_TOUCHING_KINDS.has(kind)).toBe(false)
    }
  })

  it('every member is a known tool name', () => {
    for (const kind of PEOPLE_TOUCHING_KINDS) {
      expect(PLAUD_TOOL_NAMES.has(kind)).toBe(true)
    }
  })
})
