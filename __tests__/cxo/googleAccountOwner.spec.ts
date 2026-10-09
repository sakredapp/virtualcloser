import { describe, expect, it } from 'vitest'
import { ownsGoogleAccount } from '@/lib/googleAccountOwner'

describe('ownsGoogleAccount', () => {
  const owner = { id: 'o', role: 'owner' }
  const admin = { id: 'a', role: 'admin' }
  const member = { id: 'm', role: 'member' }

  it('the workspace row belongs to the owner only', () => {
    expect(ownsGoogleAccount({ memberId: null }, owner)).toBe(true)
    expect(ownsGoogleAccount({ memberId: null }, admin)).toBe(false)
    expect(ownsGoogleAccount({ memberId: null }, member)).toBe(false)
  })

  it("a member's row belongs to that member, not the owner or an admin", () => {
    expect(ownsGoogleAccount({ memberId: 'm' }, member)).toBe(true)
    expect(ownsGoogleAccount({ memberId: 'm' }, owner)).toBe(false)
    expect(ownsGoogleAccount({ memberId: 'm' }, admin)).toBe(false)
  })

  it('no viewer owns nothing', () => {
    expect(ownsGoogleAccount({ memberId: null }, null)).toBe(false)
  })
})
