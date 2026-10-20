import { describe, expect, it } from 'vitest'
import {
  DUTY,
  OFFICE_BOXES,
  RENTED_BOXES,
  defaultPeak,
  formatRange,
  roundMoney,
  sizePrivateServer,
  storageTbFor,
  type SizingInput,
} from '@/lib/cxoSizing'
import { CXO_PRIVATE_BUILD_FEE, CXO_PRIVATE_CARE_FEE } from '@/lib/cxoSite'

const base: SizingInput = { staff: 10, workload: 'short', offline: false, placement: 'office', fileGb: 50, fineTune: false }

describe('defaultPeak', () => {
  it('is about 18% of staff, at least one person', () => {
    expect(defaultPeak(100)).toBe(18)
    expect(defaultPeak(1)).toBe(1)
    expect(defaultPeak(3)).toBe(1)
  })
})

describe('sizePrivateServer: which box', () => {
  it('a 10-person office asking short questions gets the small office box', () => {
    const r = sizePrivateServer(base)
    expect(r.tier).toBe('office-small')
    expect(r.boxes).toBe(1)
  })
  it('25 people with mixed work outgrow the small box', () => {
    expect(sizePrivateServer({ ...base, staff: 25, workload: 'mixed' }).tier).toBe('office')
  })
  it('long documents need more box than short questions for the same team', () => {
    expect(sizePrivateServer({ ...base, staff: 50, workload: 'short' }).tier).toBe('office')
    expect(sizePrivateServer({ ...base, staff: 50, workload: 'long' }).tier).toBe('team')
  })
  it('a few hundred people get the team server, a thousand the company server', () => {
    expect(sizePrivateServer({ ...base, staff: 300, workload: 'mixed' }).tier).toBe('team')
    expect(sizePrivateServer({ ...base, staff: 1000, workload: 'mixed' }).tier).toBe('company')
  })
  it('past the biggest box it quotes several of them', () => {
    const r = sizePrivateServer({ ...base, staff: 3000, workload: 'long' })
    expect(r.tier).toBe('company')
    expect(r.boxes).toBeGreaterThan(1)
    expect(r.streamsCapacity).toBeGreaterThanOrEqual(r.streamsNeeded)
  })
  it('always has room for the answers being written at the peak', () => {
    for (const staff of [1, 5, 12, 40, 90, 250, 800, 2500]) {
      for (const workload of ['short', 'mixed', 'long'] as const) {
        const r = sizePrivateServer({ ...base, staff, workload })
        expect(r.streamsCapacity).toBeGreaterThanOrEqual(r.streamsNeeded)
        expect(r.streamsNeeded).toBe(Math.max(1, Math.ceil(r.peak * DUTY[workload] - 1e-9)))
      }
    }
  })
  it('an explicit peak overrides the default, capped at staff', () => {
    expect(sizePrivateServer({ ...base, staff: 20, peak: 15 }).peak).toBe(15)
    expect(sizePrivateServer({ ...base, staff: 20, peak: 99 }).peak).toBe(20)
    expect(sizePrivateServer({ ...base, staff: 20, peak: 0 }).peak).toBe(1)
  })
})

describe('rented vs office', () => {
  it('rented when asked and allowed online', () => {
    const r = sizePrivateServer({ ...base, placement: 'rented' })
    expect(r.tier).toBe('rented')
    expect(r.monthlyParts.rent[0]).toBeGreaterThan(0)
    expect(r.monthlyParts.power).toEqual([0, 0])
  })
  it('offline forces an office box even when rented was picked', () => {
    const r = sizePrivateServer({ ...base, placement: 'rented', offline: true })
    expect(r.tier).toBe('office-small')
    expect(r.offlineForcedOffice).toBe(true)
  })
  it('a big rented need steps up to the bigger rented server', () => {
    const r = sizePrivateServer({ ...base, staff: 400, workload: 'mixed', placement: 'rented' })
    expect(r.size).toBe(RENTED_BOXES[1].size)
  })
})

describe('costs', () => {
  it('monthly = power + UPS + rent + our care fee', () => {
    const r = sizePrivateServer({ ...base, staff: 300, workload: 'mixed' })
    const p = r.monthlyParts
    expect(r.monthly[0]).toBe(Math.round(p.power[0] + p.ups[0] + p.rent[0] + p.care))
    expect(r.monthly[1]).toBe(Math.round(p.power[1] + p.ups[1] + p.rent[1] + p.care))
    expect(p.care).toBe(CXO_PRIVATE_CARE_FEE.team)
  })
  it('uses the draft build fee for the box', () => {
    for (const box of OFFICE_BOXES) {
      const staff = { 'office-small': 5, office: 25, team: 300, company: 1000, rented: 5 }[box.tier]
      const r = sizePrivateServer({ ...base, staff, workload: 'mixed' })
      expect(r.tier).toBe(box.tier)
      expect(r.buildFee).toBe(CXO_PRIVATE_BUILD_FEE[box.tier])
    }
  })
  it('ranges run low to high and grow with box size', () => {
    let last = 0
    for (const staff of [5, 25, 300, 1000]) {
      const r = sizePrivateServer({ ...base, staff, workload: 'mixed' })
      expect(r.hardware[0]).toBeLessThanOrEqual(r.hardware[1])
      expect(r.monthly[0]).toBeLessThanOrEqual(r.monthly[1])
      expect(r.hardware[0]).toBeGreaterThan(last)
      last = r.hardware[0]
    }
  })
  it('more files means more storage and a higher hardware cost', () => {
    const small = sizePrivateServer({ ...base, fileGb: 50 })
    const big = sizePrivateServer({ ...base, fileGb: 3000 })
    expect(big.storageTb).toBeGreaterThan(small.storageTb)
    expect(big.hardware[0]).toBeGreaterThan(small.hardware[0])
  })
  it('fine-tuning adds a one-time training run', () => {
    expect(sizePrivateServer(base).fineTuneRun).toBeNull()
    expect(sizePrivateServer({ ...base, fineTune: true }).fineTuneRun).toEqual([500, 2000])
  })
})

describe('storage and formatting', () => {
  it('rounds storage up to a size we buy', () => {
    expect(storageTbFor(70, 0)).toBe(1)
    expect(storageTbFor(180, 400)).toBe(2)
    expect(storageTbFor(460, 10_000)).toBe(32)
  })
  it('formats money ranges plainly', () => {
    expect(roundMoney(1234)).toBe(1200)
    expect(roundMoney(56_789)).toBe(57_000)
    expect(formatRange([5100, 5400])).toBe('$5,100 to $5,400')
    expect(formatRange([500, 500])).toBe('$500')
  })
})

describe('client copy', () => {
  it('never names a chip, card, model or maker in labels', () => {
    const banned = /apple|mac|nvidia|rtx|glm|openrouter|qwen|llama|deepseek|b200|h200|blackwell|hetzner/i
    for (const b of [...OFFICE_BOXES, ...RENTED_BOXES]) {
      expect(`${b.label} ${b.size} ${b.model}`).not.toMatch(banned)
    }
  })
})
