// Generates a branded Virtual Closer invoice as a PDF Buffer using pdfkit.
// No browser / headless Chrome needed — pure Node.js.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit')

const RED    = '#FF2800'
const INK    = '#0F0F0F'
const PAPER  = '#FFFFFF'
const MUTED  = '#6B6B6B'
const CREAM  = '#F7F4EF'
const BORDER = '#E8E4DD'

export type InvoiceData = {
  invoiceNumber: string      // e.g. "VC-20260505-A3F2"
  issuedDate: string         // e.g. "May 5, 2026"
  dueDate: string            // e.g. "Upon receipt"
  clientName: string
  clientEmail: string
  lineItem: {
    description: string
    amountCents: number
  }
  note?: string
  paymentUrl: string
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
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

    const W = doc.page.width   // 612
    const L = 54               // left margin
    const R = W - 54           // right edge
    const cW = R - L           // content width ~504

    // ── Red top accent bar ─────────────────────────────────────────────
    doc.rect(0, 0, W, 5).fill(RED)

    // ── Header: company + INVOICE label ───────────────────────────────
    const hY = 28
    doc.font('Helvetica-Bold').fontSize(18).fillColor(INK)
       .text('VIRTUAL CLOSER', L, hY, { width: cW * 0.55 })
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
       .text('virtualcloser.com', L, hY + 24)

    // INVOICE in red, right-aligned
    doc.font('Helvetica-Bold').fontSize(28).fillColor(RED)
       .text('INVOICE', L + cW * 0.5, hY - 2, { width: cW * 0.5, align: 'right' })
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
       .text(`#${data.invoiceNumber}`, L + cW * 0.5, hY + 30, { width: cW * 0.5, align: 'right' })

    // ── Red divider under header ────────────────────────────────────────
    const div1Y = 76
    doc.moveTo(L, div1Y).lineTo(R, div1Y).strokeColor(RED).lineWidth(1.5).stroke()

    // ── Metadata row ───────────────────────────────────────────────────
    const metaY = div1Y + 14
    const col = cW / 3

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
       .text('DATE ISSUED', L, metaY, { characterSpacing: 0.8 })
    doc.font('Helvetica').fontSize(10.5).fillColor(INK)
       .text(data.issuedDate, L, metaY + 12)

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
       .text('DUE DATE', L + col, metaY, { characterSpacing: 0.8 })
    doc.font('Helvetica').fontSize(10.5).fillColor(INK)
       .text(data.dueDate, L + col, metaY + 12)

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
       .text('INVOICE #', L + col * 2, metaY, { characterSpacing: 0.8 })
    doc.font('Helvetica').fontSize(10.5).fillColor(INK)
       .text(data.invoiceNumber, L + col * 2, metaY + 12)

    // ── Light divider ──────────────────────────────────────────────────
    const div2Y = metaY + 34
    doc.moveTo(L, div2Y).lineTo(R, div2Y).strokeColor(BORDER).lineWidth(1).stroke()

    // ── Bill To / From ─────────────────────────────────────────────────
    const billingY = div2Y + 14
    const halfW = cW / 2 - 16

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
       .text('BILL TO', L, billingY, { characterSpacing: 0.8 })
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
       .text(data.clientName, L, billingY + 12, { width: halfW })
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
       .text(data.clientEmail, L, billingY + 26, { width: halfW })

    const fromX = L + cW / 2
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
       .text('FROM', fromX, billingY, { characterSpacing: 0.8 })
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
       .text('Virtual Closer', fromX, billingY + 12, { width: halfW })
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
       .text('hello@virtualcloser.com', fromX, billingY + 26, { width: halfW })

    // ── Line items table ───────────────────────────────────────────────
    const tableY = billingY + 56

    // Table outer border
    const rowH = 40
    const tableH = 28 + rowH
    doc.rect(L, tableY, cW, tableH).strokeColor(RED).lineWidth(1.5).stroke()

    // Header row — cream background
    doc.rect(L, tableY, cW, 28).fill(CREAM)
    doc.font('Helvetica-Bold').fontSize(8).fillColor(RED)
       .text('DESCRIPTION', L + 14, tableY + 9, { width: cW * 0.65, characterSpacing: 0.7 })
    doc.font('Helvetica-Bold').fontSize(8).fillColor(RED)
       .text('AMOUNT', R - 14 - 70, tableY + 9, { width: 70, align: 'right', characterSpacing: 0.7 })

    // Header/row divider
    doc.moveTo(L, tableY + 28).lineTo(R, tableY + 28).strokeColor(RED).lineWidth(1).stroke()

    // Line item row
    const amount = formatDollars(data.lineItem.amountCents)
    doc.font('Helvetica').fontSize(10.5).fillColor(INK)
       .text(data.lineItem.description, L + 14, tableY + 28 + 12, { width: cW * 0.65 })
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK)
       .text(amount, R - 14 - 70, tableY + 28 + 12, { width: 70, align: 'right' })

    // ── Total box — red bordered ───────────────────────────────────────
    const totalBoxW = cW * 0.38
    const totalBoxX = R - totalBoxW
    const totalY = tableY + tableH + 14

    doc.rect(totalBoxX, totalY, totalBoxW, 38).strokeColor(RED).lineWidth(1.5).stroke()
    doc.font('Helvetica-Bold').fontSize(8).fillColor(RED)
       .text('TOTAL DUE', totalBoxX + 14, totalY + 7, { characterSpacing: 0.8 })
    doc.font('Helvetica-Bold').fontSize(15).fillColor(RED)
       .text(amount, R - 14 - 80, totalY + 4, { width: 80, align: 'right' })

    // ── Note ──────────────────────────────────────────────────────────
    let noteEndY = totalY + 38 + 14
    if (data.note) {
      noteEndY = totalY + 38 + 20
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
         .text('NOTE', L, noteEndY, { characterSpacing: 0.8 })
      doc.font('Helvetica').fontSize(9.5).fillColor(INK)
         .text(data.note, L, noteEndY + 12, { width: cW })
      noteEndY += 30 + (data.note.length > 100 ? 12 : 0)
    }

    // ── Payment instructions ───────────────────────────────────────────
    const payY = noteEndY + 18
    doc.moveTo(L, payY).lineTo(R, payY).strokeColor(BORDER).lineWidth(1).stroke()

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
       .text('How to pay', L, payY + 12)
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
       .text('Click the secure payment link in your email, or copy this URL into your browser:', L, payY + 26, { width: cW })
    doc.font('Helvetica').fontSize(8.5).fillColor(RED)
       .text(data.paymentUrl, L, payY + 42, { width: cW, underline: true })

    // ── Footer ─────────────────────────────────────────────────────────
    doc.switchToPage(0)
    const footerY = doc.page.height - 44
    doc.moveTo(0, footerY).lineTo(W, footerY).strokeColor(RED).lineWidth(2).stroke()
    doc.rect(0, footerY, W, 44).fill(CREAM)
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
       .text(
         'Virtual Closer  ·  virtualcloser.com  ·  hello@virtualcloser.com  ·  Questions? Reply to this email.',
         L, footerY + 15,
         { width: cW, align: 'center', lineBreak: false },
       )

    doc.end()
  })
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function makeInvoiceNumber(sessionId: string): string {
  const date = new Date()
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const suffix = sessionId.slice(-5).toUpperCase()
  return `VC-${ymd}-${suffix}`
}
