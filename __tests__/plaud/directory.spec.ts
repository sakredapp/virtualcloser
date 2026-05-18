import { describe, expect, it } from 'vitest'
import { displayNameFromAddress, resolveRecipient, type DirectoryEntry } from '@/lib/plaud/directory'

const directory: DirectoryEntry[] = [
  { id: 'm1', display_name: 'Lauren Martinez', aliases: ['Lo'], email: 'lauren@example.com', role: 'EA', member_id: 'm1', source: 'member' },
  { id: 'm2', display_name: 'Lauren O\'Brien', aliases: [], email: 'lo@example.com', role: 'Co-founder', member_id: 'm2', source: 'member' },
  { id: 'c1', display_name: 'Mike Johnson', aliases: ['Mike', 'MJ'], email: 'mike@example.com', role: null, member_id: null, source: 'contact' },
  { id: 'c2', display_name: 'Jordan Lee', aliases: [], email: null, role: null, member_id: null, source: 'contact' },
]

describe('resolveRecipient', () => {
  it('returns no match for empty / whitespace input', () => {
    expect(resolveRecipient('', directory).matched).toBe(false)
    expect(resolveRecipient('   ', directory).matched).toBe(false)
  })

  it('exact display_name match (case-insensitive) resolves uniquely', () => {
    const r = resolveRecipient('mike johnson', directory)
    expect(r.matched).toBe(true)
    expect(r.contact_id).toBe('c1')
    expect(r.email).toBe('mike@example.com')
  })

  it('alias match resolves uniquely', () => {
    const r = resolveRecipient('mj', directory)
    expect(r.matched).toBe(true)
    expect(r.contact_id).toBe('c1')
  })

  it('first-token match resolves when there is exactly one candidate', () => {
    // "Jordan" only matches Jordan Lee on first token.
    const r = resolveRecipient('Jordan', directory)
    expect(r.matched).toBe(true)
    expect(r.contact_id).toBe('c2')
  })

  it('first-token match returns ambiguous when multiple candidates share the token', () => {
    // Two "Lauren" entries → ambiguous, no resolution.
    const r = resolveRecipient('Lauren', directory)
    expect(r.matched).toBe(false)
    expect(r.ambiguous).toBe(true)
  })

  it('email lookup wins over name search', () => {
    const r = resolveRecipient('lauren@example.com', directory)
    expect(r.matched).toBe(true)
    expect(r.email).toBe('lauren@example.com')
    expect(r.member_id).toBe('m1')
  })

  it('unknown email is still returned as matched (external recipient)', () => {
    const r = resolveRecipient('stranger@elsewhere.com', directory)
    expect(r.matched).toBe(true)
    expect(r.email).toBe('stranger@elsewhere.com')
    expect(r.member_id).toBeNull()
    expect(r.contact_id).toBeNull()
  })

  it('unknown name returns unmatched without crashing', () => {
    const r = resolveRecipient('Some Person Not Here', directory)
    expect(r.matched).toBe(false)
    expect(r.ambiguous).toBe(false)
  })

  it('ignores punctuation / case when normalising', () => {
    // Apostrophe stripped by normalize() — "Lauren OBrien" should still hit by exact match.
    const r = resolveRecipient("Lauren OBrien", directory)
    expect(r.matched).toBe(true)
    expect(r.member_id).toBe('m2')
  })
})

describe('displayNameFromAddress', () => {
  it('returns provided name if non-empty', () => {
    expect(displayNameFromAddress('Lauren M', 'lauren@example.com')).toBe('Lauren M')
  })

  it('handles separator-style local-parts (dot/underscore/dash)', () => {
    expect(displayNameFromAddress(null, 'jane.doe@example.com')).toBe('Jane Doe')
    expect(displayNameFromAddress(null, 'jane_doe@example.com')).toBe('Jane Doe')
    expect(displayNameFromAddress(null, 'jane-doe@example.com')).toBe('Jane Doe')
  })

  it('splits camelCase local-parts', () => {
    expect(displayNameFromAddress(null, 'spencerDunningham@example.com')).toBe('Spencer Dunningham')
  })

  it('lowercases SCREAMING tails when titleizing', () => {
    expect(displayNameFromAddress(null, 'JANE.DOE@example.com')).toBe('Jane Doe')
  })

  it('falls back gracefully on a plain local-part (no separators, no case mix)', () => {
    expect(displayNameFromAddress(null, 'spencerdunningham@example.com')).toBe('Spencerdunningham')
  })

  it('trims whitespace from provided name', () => {
    expect(displayNameFromAddress('   Lauren   ', 'lauren@example.com')).toBe('Lauren')
  })
})
