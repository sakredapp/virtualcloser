import { describe, expect, it } from 'vitest'
import { isNotSharedError } from '@/lib/pinnacle/airtable'

describe('isNotSharedError', () => {
  it('treats an Airtable 403 as a table not shared with the token yet', () => {
    expect(isNotSharedError('airtable appX/Pinnacle Annuity Policies HTTP 403: {"error":{"type":"INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND"}}')).toBe(true)
  })
  it('keeps every other failure a real error', () => {
    expect(isNotSharedError('airtable appX/Policies HTTP 500: oops')).toBe(false)
    expect(isNotSharedError('airtable appX/Policies HTTP 4031: odd')).toBe(false)
    expect(isNotSharedError('supabase upsert appX/Policies: timeout')).toBe(false)
  })
})
