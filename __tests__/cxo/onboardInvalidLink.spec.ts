import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactElement } from 'react'

// No token row found: Suite CXO hosts get a branded card, every other brand keeps the 404.
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
vi.mock('next/navigation', () => ({ notFound: () => notFound(), redirect: vi.fn() }))
vi.mock('@/lib/supabase', () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null }) }
  return { supabase: { from: () => q } }
})
const brandKey = { value: 'cxo' }
vi.mock('@/lib/brand', async (orig) => {
  const real = await orig<typeof import('@/lib/brand')>()
  return { ...real, getCurrentBrand: async () => real.getBrand(brandKey.value as never) }
})

async function render(): Promise<string> {
  const { default: OnboardPage } = await import('@/app/onboard/[token]/page')
  const el = (await OnboardPage({
    params: Promise.resolve({ token: 'not-a-real-token' }),
    searchParams: Promise.resolve({}),
  })) as ReactElement
  return renderToStaticMarkup(el)
}

describe('onboard link that does not exist', () => {
  beforeEach(() => {
    notFound.mockClear()
  })

  it('shows the branded Suite CXO card on CXO hosts', async () => {
    brandKey.value = 'cxo'
    const html = await render()
    expect(html).toContain("This link isn&#x27;t valid")
    expect(html).toContain('ask your contact for a new onboarding link')
    expect(html).not.toMatch(/virtual ?closer|mira|run my ads/i)
    expect(notFound).not.toHaveBeenCalled()
  })

  it('keeps the plain 404 for other brands', async () => {
    brandKey.value = 'vc'
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('onboard done card', () => {
  it('says the signed agreement arrives in a separate email', async () => {
    const { CxOnboardDone } = await import('@/app/onboard/[token]/CxOnboardStates')
    const html = renderToStaticMarkup(createElement(CxOnboardDone, { name: 'Dana', email: 'dana@northwind.test', rootDomain: 'suitecxo.com' }))
    expect(html).toContain('comes in a separate email')
    expect(html).not.toContain('PDF copy of the')
  })
})
