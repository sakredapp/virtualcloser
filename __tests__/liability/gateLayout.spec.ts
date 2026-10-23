// The in-app agreement sign screen (.cx-gate, app/dashboard/LiabilityGate.tsx).
// QA 2026-10-21 (lane B, production): the page scrolled sideways (scrollWidth
// 1542 at 1280, 401 at 390) and ignored dark mode. Root cause: the gate was
// given the agreement as a full standalone document, and when that is server
// rendered the HTML parser merges the stray <body style="max-width:740px;
// margin:32px auto;padding:0 24px 48px;background:#fff"> onto the page's own
// <body>. The gate must get the inner body only, and the CXO shell reset and
// dark tokens must cover body:has(.cx-gate) like the login and onboard pages.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { embeddableAgreementHtml, renderAgreementHtml } from '@/lib/liabilityAgreementCopy'

const read = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8')

describe('embeddableAgreementHtml', () => {
  const full = renderAgreementHtml({ workspaceLabel: 'Acme Test Co', brand: 'cxo', titleName: null })
  const inner = embeddableAgreementHtml(full)

  it('drops the document wrapper that would restyle the host <body>', () => {
    expect(full).toMatch(/<body style=/)
    for (const tag of [/<!doctype/i, /<html/i, /<\/html>/i, /<head/i, /<title/i, /<meta/i, /<body/i, /<\/body>/i]) {
      expect(inner).not.toMatch(tag)
    }
    expect(inner).not.toContain('max-width:740px')
  })

  it('keeps everything that was shown inside the body', () => {
    expect(inner).toMatch(/^\s*<h1 /)
    expect(inner).toContain('Signature Block')
    const bodyText = /<body[^>]*>([\s\S]*)<\/body>/i.exec(full)?.[1]?.trim()
    expect(inner).toBe(bodyText)
  })

  it('passes a fragment through unchanged', () => {
    expect(embeddableAgreementHtml('<p>Hello</p>')).toBe('<p>Hello</p>')
  })
})

describe('dashboard layout gives the gate a fragment, not a document', () => {
  const layout = read('app/dashboard/layout.tsx')
  it('wraps the rendered agreement with embeddableAgreementHtml', () => {
    expect(layout).toMatch(/embeddableAgreementHtml\(\s*renderAgreementHtml\(/)
  })
})

describe('globals.css covers the sign screen', () => {
  const css = read('app/globals.css')
  it('resets the framed .cxo-shell behind the gate', () => {
    expect(css).toMatch(/:root\[data-brand='cxo'\] body:has\(\.cx-gate\) \.cxo-shell\s*\{[^}]*width:\s*100%/)
  })
  it('lists .cx-gate in the light and dark --cx-* token selectors', () => {
    expect(css).toContain(":root[data-brand='cxo'] body:has(.cx-gate),")
    expect(css).toContain(":root[data-brand='cxo'][data-theme='dark'] body:has(.cx-gate),")
  })
})
