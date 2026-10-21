// The condensed agreement box on the two Suite CXO sign surfaces
// (/onboard/[token] CxSignStep and the in-app LiabilityGate): the browser PDF
// writer behind "Download PDF", and source checks that the box is used, that
// nothing waits on scrolling, and that the sign calls and texts are unchanged.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildAgreementPdf, agreementPdfFilename, textToAgreementBlocks } from '@/lib/agreementPdf'
import { CXO_AGREEMENT_TITLE, CXO_CURRENT_VERSION, getAgreement } from '@/lib/liabilityAgreementCopy'

const ascii = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('')
const read = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8')

describe('agreement PDF (lib/agreementPdf.ts)', () => {
  const a = getAgreement('cxo')
  const pdf = ascii(
    buildAgreementPdf({
      title: a.title,
      version: a.version,
      entity: 'Suite CXO',
      date: new Date('2026-10-20T12:00:00Z'),
      meta: ['Workspace: Acme Dental Group'],
      blocks: textToAgreementBlocks(a.body.replace(/\*\*/g, '')),
    }),
  )
  it('is a well-formed multi-page PDF', () => {
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    const startxref = Number(/startxref\s+(\d+)/.exec(pdf)?.[1])
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref')
    expect(Number(/\/Count (\d+)/.exec(pdf)?.[1])).toBeGreaterThan(1)
  })
  it('prints the title, version, entity, date and workspace', () => {
    expect(pdf).toContain('(Suite CXO - Operational & Liability Agreement)')
    expect(pdf).toContain('SUITE CXO')
    expect(pdf).toContain(`Version ${CXO_CURRENT_VERSION}`)
    expect(pdf).toMatch(/October 20, 2026/)
    expect(pdf).toContain('Workspace: Acme Dental Group')
  })
  it('names the file after the title and version', () => {
    expect(agreementPdfFilename(CXO_AGREEMENT_TITLE, CXO_CURRENT_VERSION)).toBe(
      'suite-cxo-operational-liability-agreement-v2026-05-20-v1.pdf',
    )
  })
})

describe('both CXO sign surfaces use the condensed box', () => {
  const onboard = read('app/onboard/[token]/CxSignStep.tsx')
  const gate = read('app/dashboard/LiabilityGate.tsx')
  it('renders AgreementBox, with no "Go to signature" dock or scroll gate', () => {
    for (const src of [onboard, gate]) {
      expect(src).toContain('<AgreementBox')
      expect(src).not.toMatch(/Go to signature|IntersectionObserver|scrolledToBottom|readToEnd/)
    }
  })
  it('keeps the sign calls, payloads and button rules', () => {
    expect(onboard).toContain('`/api/onboard/${token}/sign`')
    expect(onboard).toContain('JSON.stringify({ name: name.trim() })')
    expect(onboard).toContain("const canFinish = agreed && name.trim().length >= 2")
    expect(onboard).toContain('data-version={agreementVersion}')
    expect(gate).toContain("'/api/me/liability/sign'")
    expect(gate).toContain('JSON.stringify({ signature_name: name.trim() })')
    expect(gate).toContain('const canSign = agreed && name.trim().length >= 3')
    expect(gate).toContain('data-version={agreementVersion}')
  })
})
