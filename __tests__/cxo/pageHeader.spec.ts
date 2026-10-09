import { describe, expect, it } from 'vitest'
import { sameLabel } from '@/app/components/sameLabel'

describe('PageHeader eyebrow', () => {
  it('drops an eyebrow that repeats the title', () => {
    expect(sameLabel('Execs', 'Execs')).toBe(true)
    expect(sameLabel(' EXECS ', 'execs')).toBe(true)
    expect(sameLabel('Sales  Plan', 'Sales Plan')).toBe(true)
  })
  it('keeps an eyebrow that adds something', () => {
    expect(sameLabel('Good morning, Mike · Friday, October 9', 'Today')).toBe(false)
    expect(sameLabel('Settings', 'Integrations')).toBe(false)
  })
})
