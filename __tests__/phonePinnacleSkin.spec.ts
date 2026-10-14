import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRAND_MARKS, PINNACLE_MARK_PATH } from '@/lib/brandMarks'
import { PHONE_VERSIONS, demoPhoneVersion, phoneShellAttrs, phoneVersionStyle } from '@/lib/phoneVersions'

const pinnacle = PHONE_VERSIONS.pinnacle

describe('Pinnacle edition on a phone', () => {
  it('uses Instrument Sans and its own money colours, lime on dark and green on light', () => {
    expect(pinnacle.skin?.font).toMatch(/Instrument Sans/)
    expect(pinnacle.skin?.font).toMatch(/--font-instrument-sans/)
    expect(pinnacle.skin?.dark.money.toLowerCase()).toBe('#d1fe17')
    expect(pinnacle.skin?.light.money.toLowerCase()).toBe('#016630')
    expect(pinnacle.skin?.dark.ground.toLowerCase()).toBe('#0f0f10')
    expect(pinnacle.skin?.dark.surface.toLowerCase()).toBe('#161617')
  })

  it('draws the real Pinnacle mark, copied from the company brand file', () => {
    expect(pinnacle.mark).toBe('pinnacle')
    const m = BRAND_MARKS.pinnacle
    expect(m.viewBox).toBe('0 0 698 737')
    expect(m.path).toBe(PINNACLE_MARK_PATH)
    expect(m.path.startsWith('M 368.167 1 L 367.367 1 184.167 368.150')).toBe(true)
    expect(m.path.endsWith('L 368.967 1 368.167 1')).toBe(true)
    expect(m.lockup).toEqual(['PINNACLE', 'LIFE GROUP'])
  })

  it('never says Score, in the version or on any phone screen', () => {
    expect(JSON.stringify(pinnacle)).not.toMatch(/score/i)
    const dirs = ['app/components/cxo/phone', 'app/cxo/demo']
    for (const d of dirs) {
      for (const f of readdirSync(d)) {
        if (!/\.(tsx?|css)$/.test(f)) continue
        expect(readFileSync(join(d, f), 'utf8'), `${d}/${f}`).not.toMatch(/\bScore\b/)
      }
    }
  })

  it('puts the skin on the shell through variables, light and dark', () => {
    const s = phoneVersionStyle(pinnacle)
    expect(s['--cxph-font']).toBe(pinnacle.skin?.font)
    expect(s['--cxph-d-money']).toBe(pinnacle.skin?.dark.money)
    expect(s['--cxph-l-money']).toBe(pinnacle.skin?.light.money)
    expect(s['--cxph-d-ground']).toBe(pinnacle.skin?.dark.ground)
    expect(phoneShellAttrs(pinnacle)).toEqual({ 'data-phone-skin': 'pinnacle' })
  })

  it('leaves the product look alone: no skin, no mark, no attribute', () => {
    expect(PHONE_VERSIONS.cxo.skin).toBeNull()
    expect(PHONE_VERSIONS.cxo.mark).toBeNull()
    expect(phoneShellAttrs(PHONE_VERSIONS.cxo)).toEqual({})
    expect(phoneShellAttrs(null)).toEqual({})
  })

  it('never shows the client look on the public demo', () => {
    const book = demoPhoneVersion('book', 'Northgate Group')
    expect(book.skin).toBeNull()
    expect(book.mark).toBeNull()
    expect(phoneShellAttrs(book)).toEqual({})
    expect(Object.keys(phoneVersionStyle(book)).some((k) => k.startsWith('--cxph-l-') || k.startsWith('--cxph-d-'))).toBe(false)
  })

  it('keeps every skin rule inside the phone width', () => {
    const css = readFileSync('app/components/cxo/phone/cxo-phone.css', 'utf8')
    const at = css.indexOf("[data-phone-skin] {")
    expect(at).toBeGreaterThan(0)
    const before = css.slice(0, at)
    expect(before.lastIndexOf('@media (max-width: 640px)')).toBeGreaterThan(before.lastIndexOf('\n}\n'))
  })
})
