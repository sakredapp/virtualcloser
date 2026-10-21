'use client'

/**
 * THE CONDENSED AGREEMENT BOX (Suite CXO). Every place a person signs on Suite
 * CXO (the /onboard/[token] sign step and the in-app LiabilityGate) shows the
 * agreement as a compact box instead of one long scroll:
 *
 *   - the title, version and a short clipped preview with a fade;
 *   - "Read full agreement" opens a sheet (a bottom sheet on a phone);
 *   - "Download PDF" saves the exact text with its title, version, entity and
 *     date, drawn in the browser (lib/agreementPdf.ts), so it works with no
 *     login and no server call;
 *   - the sign block stays right under the box, in the caller.
 *
 * It only changes how the text is shown. The agreement HTML is rendered as
 * given, and nothing here gates signing on reading or scrolling.
 *
 * Black / silver / white --cx-* tokens with neutral fallbacks (the gate renders
 * outside the token scope). No red, no amber.
 * Refs (Mobbin): Public "Accept your Brokerage terms", Starling "Terms and
 * conditions", Neo Financial "Review", Zillow "Signatures requested".
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  agreementPdfFilename,
  buildAgreementPdf,
  type AgreementPdfBlock,
  type AgreementPdfInput,
} from '@/lib/agreementPdf'

/** Save an agreement as a PDF (Blob + object URL, no network). */
export function downloadAgreementPdf(input: AgreementPdfInput): void {
  const bytes = buildAgreementPdf(input)
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = agreementPdfFilename(input.title, input.version)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

const clean = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()

/**
 * Turn the rendered agreement into PDF blocks, in document order: headings,
 * paragraphs, lists, and table rows (cells joined). The printed title is
 * skipped when the HTML repeats it, since the PDF header already prints it.
 */
export function htmlElementToAgreementBlocks(root: Element, skipTitle?: string): AgreementPdfBlock[] {
  const SEL = 'h1,h2,h3,h4,p,ul,ol,tr'
  const out: AgreementPdfBlock[] = []
  const skip = clean(skipTitle).toLowerCase()
  root.querySelectorAll(SEL).forEach((el) => {
    // A <p> inside an <li> (or a nested list) is printed by its outer block.
    const outer = el.parentElement?.closest(SEL)
    if (outer && root.contains(outer)) return
    const tag = el.tagName.toLowerCase()
    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === 'li')
        .map((li) => clean(li.textContent))
        .filter(Boolean)
      if (items.length) out.push({ kind: 'ul', items })
      return
    }
    if (tag === 'tr') {
      const text = Array.from(el.children).map((c) => clean(c.textContent)).filter(Boolean).join(' ')
      if (text) out.push({ kind: 'p', text })
      return
    }
    const text = clean(el.textContent)
    if (!text) return
    if (tag === 'h1' && skip && text.toLowerCase() === skip) return
    const kind = tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : tag === 'p' ? 'p' : 'h3'
    out.push({ kind, text })
  })
  return out
}

function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  )
}
function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  )
}
function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

const CX_VARS = [
  '--cx-ground', '--cx-surface', '--cx-ink', '--cx-muted', '--cx-faint', '--cx-line', '--cx-line-strong',
  '--cx-accent', '--cx-accent-hover', '--cx-on-accent', '--cx-tint', '--cx-serif', '--cx-sans', '--cx-silver',
]

type Props = {
  /** The agreement title (shown in the box and printed on the PDF). */
  title: string
  version: string
  /** A quiet line under the title (e.g. "not legal advice"). */
  meta?: ReactNode
  /** The agreement as HTML, rendered exactly as given. */
  html: string
  /** Who the agreement is with, printed on the PDF. */
  entity: string
  /** Extra PDF header lines (e.g. the workspace). */
  pdfMeta?: string[]
  /** The existing typography class for the agreement body (cx-onboard-body, cx-gate-doc). */
  bodyClassName: string
  testId: string
  className?: string
}

export default function AgreementBox({ title, version, meta, html, entity, pdfMeta, bodyClassName, testId, className }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // A narrow box stacks the two actions so neither wraps.
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setNarrow(el.clientWidth > 0 && el.clientWidth < 340)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onDownload = useCallback(() => {
    setSaveError(null)
    try {
      const src = bodyRef.current
      const blocks = src ? htmlElementToAgreementBlocks(src, title) : []
      if (!blocks.length) throw new Error('empty')
      downloadAgreementPdf({ title, version, entity, meta: pdfMeta, blocks })
    } catch {
      setSaveError("We couldn't make the PDF. Open the full agreement instead.")
    }
  }, [title, version, entity, pdfMeta])

  return (
    <div ref={boxRef} className={`cx-agree${narrow ? ' is-narrow' : ''}${className ? ` ${className}` : ''}`} data-testid={testId}>
      <div className="cx-agree-head">
        <span className="cx-agree-icon"><DocIcon /></span>
        <div className="cx-agree-titles">
          <p className="cx-agree-title">{title}</p>
          <p className="cx-agree-version">Version {version}</p>
          {meta ? <div className="cx-agree-meta">{meta}</div> : null}
        </div>
      </div>

      <div className="cx-agree-clip">
        <div
          ref={bodyRef}
          data-testid={`${testId}-body`}
          className={`cx-agree-body ${bodyClassName}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <div className="cx-agree-fade" aria-hidden="true" />
      </div>

      <div className="cx-agree-actions">
        <button type="button" className="cx-agree-read" data-testid={`${testId}-read`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
          Read full agreement <ChevronIcon />
        </button>
        <button type="button" className="cx-agree-dl" data-testid={`${testId}-download`} onClick={onDownload}>
          <DownloadIcon /> Download PDF
        </button>
      </div>
      {saveError ? <p className="cx-agree-error" role="alert">{saveError}</p> : null}

      {open ? (
        <AgreementSheet
          title={title}
          version={version}
          html={html}
          bodyClassName={bodyClassName}
          source={boxRef.current}
          testId={`${testId}-sheet`}
          onClose={() => setOpen(false)}
          onDownload={onDownload}
        />
      ) : null}
    </div>
  )
}

function AgreementSheet({
  title,
  version,
  html,
  bodyClassName,
  source,
  testId,
  onClose,
  onDownload,
}: {
  title: string
  version: string
  html: string
  bodyClassName: string
  source: HTMLElement | null
  testId: string
  onClose: () => void
  onDownload: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  // The sheet is portalled to <body>, outside the gate's subtree, so it copies
  // the box's resolved --cx-* values (light or dark) onto itself.
  const [vars] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    if (source && typeof getComputedStyle !== 'undefined') {
      const cs = getComputedStyle(source)
      for (const n of CX_VARS) {
        const v = cs.getPropertyValue(n).trim()
        if (v) out[n] = v
      }
    }
    return out
  })

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      prev?.focus?.()
    }
  }, [onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="cx-agree-sheet" data-testid={testId} role="dialog" aria-modal="true" aria-label={title} style={vars}>
      <div className="cx-agree-sheet-scrim" aria-hidden="true" onClick={onClose} />
      <div className="cx-agree-sheet-card">
        <div className="cx-agree-sheet-grab" aria-hidden="true"><span /></div>
        <div className="cx-agree-sheet-head">
          <div className="cx-agree-titles">
            <p className="cx-agree-title">{title}</p>
            <p className="cx-agree-version">Version {version}</p>
          </div>
          <button ref={closeRef} type="button" className="cx-agree-sheet-x" data-testid={`${testId}-close`} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="cx-agree-sheet-scroll">
          <div className={bodyClassName} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <div className="cx-agree-sheet-foot">
          <button type="button" className="cx-agree-sheet-dl" data-testid={`${testId}-download`} onClick={onDownload}>
            <DownloadIcon /> Download PDF
          </button>
          <button type="button" className="cx-agree-sheet-done" data-testid={`${testId}-done`} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
