// Generates a branded, multi-page PDF of the signed Operational & Liability Agreement.
// Uses pdfkit (same as invoice PDF) — no headless Chrome needed.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit')
import { AGREEMENT_BODY, AGREEMENT_TITLE, CURRENT_VERSION } from '@/lib/liabilityAgreementCopy'

const RED    = '#FF2800'
const INK    = '#0F0F0F'
const MUTED  = '#6B6B6B'
const CREAM  = '#F7F4EF'
const BORDER = '#E5E7EB'
const NAVY   = '#0B1F5C'

export type AgreementPdfArgs = {
  signatureName: string
  signedAt: string        // ISO timestamp
  workspaceLabel?: string | null
  ipAddress?: string | null
}

export async function generateAgreementPdf(args: AgreementPdfArgs): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 0, left: 0, right: 0, bottom: 0 },
      bufferPages: true,
    })
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const W  = doc.page.width   // 612
    const PH = doc.page.height  // 792
    const ML = 60
    const MR = 60
    const CW = W - ML - MR      // 492
    const FOOTER_H = 36
    const SAFE_BOTTOM = PH - FOOTER_H - 16

    // ── Helpers ──────────────────────────────────────────────────────────
    function ensureSpace(needed: number) {
      if (doc.y + needed > SAFE_BOTTOM) {
        doc.addPage()
        // Continuation header
        doc.rect(0, 0, W, 4).fill(RED)
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED)
           .text('VIRTUAL CLOSER  ·  Operational & Liability Agreement (continued)', ML, 14, { width: CW, lineBreak: false })
        doc.moveTo(ML, 30).lineTo(W - MR, 30).strokeColor(BORDER).lineWidth(0.5).stroke()
        doc.text('', ML, 42)
      }
    }

    function gap(pt: number) { doc.text('', ML, doc.y + pt) }

    // ── Page 1 header ────────────────────────────────────────────────────
    doc.rect(0, 0, W, 4).fill(RED)
    doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text('VIRTUAL CLOSER', ML, 22)
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('virtualcloser.com', ML, 42)
    doc.font('Helvetica-Bold').fontSize(8).fillColor(RED)
       .text('ELECTRONIC SIGNATURE DOCUMENT', ML, 22, { width: CW, align: 'right', characterSpacing: 0.4, lineBreak: false })
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
       .text(`Version ${CURRENT_VERSION}`, ML, 34, { width: CW, align: 'right', lineBreak: false })

    doc.moveTo(ML, 60).lineTo(W - MR, 60).strokeColor(RED).lineWidth(1.5).stroke()

    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK)
       .text(AGREEMENT_TITLE, ML, 74, { width: CW })
    gap(4)
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
       .text(
         'This document is not legal advice. Consult qualified legal counsel for guidance specific to your business and jurisdiction.',
         ML, doc.y, { width: CW }
       )
    gap(6)
    doc.moveTo(ML, doc.y).lineTo(W - MR, doc.y).strokeColor(BORDER).lineWidth(0.75).stroke()
    gap(14)

    // ── Document body ────────────────────────────────────────────────────
    const sections = AGREEMENT_BODY.split('\n\n').map((s) => s.trim()).filter(Boolean)

    for (const section of sections) {
      ensureSpace(42)

      if (section === '---') {
        doc.moveTo(ML, doc.y + 2).lineTo(W - MR, doc.y + 2).strokeColor(BORDER).lineWidth(0.5).stroke()
        gap(12)
        continue
      }

      if (section.startsWith('**Effective version:**')) {
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
           .text(section.replace(/\*\*/g, ''), ML, doc.y, { width: CW })
        gap(10)
        continue
      }

      if (section.startsWith('## ')) {
        gap(4)
        doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
           .text(section.slice(3), ML, doc.y, { width: CW })
        gap(6)
        continue
      }

      // Bullet list
      if (section.startsWith('- ') || section.includes('\n- ')) {
        const lines = section.split('\n').filter((l) => l.trim())
        for (const line of lines) {
          ensureSpace(22)
          if (line.startsWith('- ')) {
            const text = stripBold(line.slice(2))
            const bulletY = doc.y
            doc.font('Helvetica').fontSize(9).fillColor(INK)
               .text('•', ML + 6, bulletY, { lineBreak: false })
            doc.font('Helvetica').fontSize(9).fillColor(INK)
               .text(text, ML + 20, bulletY, { width: CW - 20 })
          } else {
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
               .text(stripBold(line), ML, doc.y, { width: CW })
          }
          gap(2)
        }
        gap(6)
        continue
      }

      // Lettered sub-list (a) (b) (c)
      if (/^\([a-z]\)/.test(section)) {
        const lines = section.split('\n').filter((l) => l.trim())
        for (const line of lines) {
          ensureSpace(20)
          const match = line.match(/^(\([a-z]\))\s*(.*)/)
          if (match) {
            const lineY = doc.y
            doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
               .text(match[1], ML + 6, lineY, { lineBreak: false })
            doc.font('Helvetica').fontSize(9).fillColor(INK)
               .text(stripBold(match[2]), ML + 28, lineY, { width: CW - 28 })
          } else {
            doc.font('Helvetica').fontSize(9).fillColor(INK)
               .text(stripBold(line), ML, doc.y, { width: CW })
          }
          gap(2)
        }
        gap(6)
        continue
      }

      // Regular paragraph
      doc.font('Helvetica').fontSize(9.5).fillColor(INK)
         .text(stripBold(section), ML, doc.y, { width: CW, lineGap: 1 })
      gap(10)
    }

    // ── Signature block ──────────────────────────────────────────────────
    ensureSpace(170)
    gap(12)

    const sigY = doc.y
    const sigH = 156

    doc.rect(ML, sigY, CW, sigH).strokeColor(NAVY).lineWidth(1.5).stroke()
    // Header band
    doc.rect(ML, sigY, CW, 30).fill(NAVY)
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff')
       .text('ELECTRONIC SIGNATURE — LEGALLY BINDING', ML + 14, sigY + 11, { characterSpacing: 0.5, lineBreak: false })

    // E-SIGN note
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
       .text(
         'Signed under the E-SIGN Act (15 U.S.C. § 7001) and UETA. This typed name carries the same legal weight as a handwritten signature.',
         ML + 14, sigY + 40, { width: CW - 28 }
       )

    const col2X = ML + CW / 2
    const fY = sigY + 70

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
       .text('SIGNED BY', ML + 14, fY, { characterSpacing: 0.5, lineBreak: false })
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
       .text('DATE & TIME (UTC)', col2X, fY, { characterSpacing: 0.5, lineBreak: false })

    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK)
       .text(args.signatureName, ML + 14, fY + 13, { width: CW / 2 - 20, lineBreak: false })

    const dateStr = new Date(args.signedAt).toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }) + ' UTC'
    doc.font('Helvetica').fontSize(9.5).fillColor(INK)
       .text(dateStr, col2X, fY + 15, { width: CW / 2 - 14, lineBreak: false })

    doc.moveTo(ML + 14, fY + 36).lineTo(ML + CW - 14, fY + 36)
       .strokeColor(BORDER).lineWidth(0.5).stroke()

    const f2Y = fY + 44
    if (args.workspaceLabel) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
         .text('WORKSPACE', ML + 14, f2Y, { characterSpacing: 0.5, lineBreak: false })
      doc.font('Helvetica').fontSize(9).fillColor(INK)
         .text(args.workspaceLabel, ML + 14, f2Y + 12, { lineBreak: false })
    }
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
       .text('AGREEMENT VERSION', col2X, f2Y, { characterSpacing: 0.5, lineBreak: false })
    doc.font('Helvetica').fontSize(9).fillColor(INK)
       .text(CURRENT_VERSION, col2X, f2Y + 12, { lineBreak: false })

    if (args.ipAddress) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
         .text('IP ADDRESS', ML + 14, f2Y + 28, { characterSpacing: 0.5, lineBreak: false })
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
         .text(args.ipAddress, ML + 14, f2Y + 40, { lineBreak: false })
    }

    // ── Footer on every page ─────────────────────────────────────────────
    const range = (doc as unknown as { bufferedPageRange(): { start: number; count: number } }).bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i)
      const fTop = PH - FOOTER_H
      doc.rect(0, fTop, W, FOOTER_H).fill(CREAM)
      doc.moveTo(0, fTop).lineTo(W, fTop).strokeColor(RED).lineWidth(1.5).stroke()
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
         .text(
           `Virtual Closer  ·  virtualcloser.com  ·  hello@virtualcloser.com  ·  Page ${i + 1} of ${range.count}`,
           ML, fTop + 13, { width: CW, align: 'center', lineBreak: false },
         )
    }

    doc.end()
  })
}

function stripBold(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1')
}
