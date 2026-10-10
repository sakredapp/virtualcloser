import { describe, expect, it } from 'vitest'
import { miraPool } from '@/lib/cxoUsageShared'

describe('miraPool', () => {
  it('pools 500 per paid seat; assistants and employee logins add nothing', () => {
    const p = miraPool(['owner', 'admin', 'member', 'member', 'assistant', 'rep', 'observer'], 1200)
    expect(p).toEqual({ seats: 4, perSeat: 500, included: 2000, used: 1200, over: 0 })
  })
  it('one person can use the whole pool; only the org total goes over', () => {
    expect(miraPool(['owner', 'admin'], 1150).over).toBe(150)
  })
  it('never below one seat, honours a tenant override', () => {
    expect(miraPool([], 0, 800)).toMatchObject({ seats: 1, included: 800 })
  })
})
