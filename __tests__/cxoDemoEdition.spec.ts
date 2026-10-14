import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { demoEdition } from '@/lib/phoneVersions'

describe('the demo edition switch (/cxo/demo?edition=pinnacle)', () => {
  it('shows the Pinnacle look only on the local dev server', () => {
    expect(demoEdition('pinnacle', 'development')).toBe('pinnacle')
    expect(demoEdition(['pinnacle', 'x'], 'development')).toBe('pinnacle')
  })

  it('never shows a client on a deployed build, previews included', () => {
    expect(demoEdition('pinnacle', 'production')).toBeNull()
    expect(demoEdition('pinnacle', 'test')).toBeNull()
    expect(demoEdition('pinnacle', undefined)).toBeNull()
  })

  it('ignores anything that is not a known edition', () => {
    expect(demoEdition(undefined, 'development')).toBeNull()
    expect(demoEdition('cxo', 'development')).toBeNull()
    expect(demoEdition('Pinnacle ', 'development')).toBeNull()
  })

  it('is gated on NODE_ENV in the page itself', () => {
    const page = readFileSync('app/cxo/demo/page.tsx', 'utf8')
    expect(page).toMatch(/demoEdition\(sp\?\.edition, process\.env\.NODE_ENV\)/)
  })
})
