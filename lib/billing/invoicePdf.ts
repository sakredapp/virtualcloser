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

export type InvoiceLineItem = {
  description: string
  amountCents: number
}

export type InvoiceData = {
  invoiceNumber: string      // e.g. "VC-20260505-A3F2"
  issuedDate: string         // e.g. "May 5, 2026"
  dueDate: string            // e.g. "Upon receipt" or "Paid"
  clientName: string
  clientEmail: string
  lineItems: InvoiceLineItem[]
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
    const headerH = 28
    const rowH = 36

    const tableH = headerH + rowH * data.lineItems.length

    // Table outer border
    doc.rect(L, tableY, cW, tableH).strokeColor(RED).lineWidth(1.5).stroke()

    // Header row — cream background
    doc.rect(L, tableY, cW, headerH).fill(CREAM)
    doc.font('Helvetica-Bold').fontSize(8).fillColor(RED)
       .text('DESCRIPTION', L + 14, tableY + 9, { width: cW * 0.65, characterSpacing: 0.7 })
    doc.font('Helvetica-Bold').fontSize(8).fillColor(RED)
       .text('AMOUNT', R - 14 - 70, tableY + 9, { width: 70, align: 'right', characterSpacing: 0.7 })

    // Header/rows divider
    doc.moveTo(L, tableY + headerH).lineTo(R, tableY + headerH).strokeColor(RED).lineWidth(1).stroke()

    // Line item rows
    data.lineItems.forEach((item, idx) => {
      const y = tableY + headerH + rowH * idx
      // Alternate cream tint on every other row
      if (idx % 2 === 1) {
        doc.rect(L + 1, y, cW - 2, rowH - 1).fill('#FDFCFA')
      }
      // Row divider (except after last row — outer border covers that)
      if (idx < data.lineItems.length - 1) {
        doc.moveTo(L, y + rowH).lineTo(R, y + rowH).strokeColor(BORDER).lineWidth(0.5).stroke()
      }
      const cleanDesc = cleanLineDescription(item.description)
      doc.font('Helvetica').fontSize(10).fillColor(INK)
         .text(cleanDesc, L + 14, y + 11, { width: cW * 0.65 })
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
         .text(formatDollars(item.amountCents), R - 14 - 70, y + 11, { width: 70, align: 'right' })
    })

    // ── Subtotal + Total box ───────────────────────────────────────────
    const totalCents = data.lineItems.reduce((s, l) => s + l.amountCents, 0)
    const showSubtotal = data.lineItems.length > 1
    const totalBoxW = cW * 0.38
    const totalBoxX = R - totalBoxW
    const boxesY = tableY + tableH + 14

    if (showSubtotal) {
      // Subtotal row
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
         .text('Subtotal', totalBoxX + 14, boxesY + 4)
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
         .text(formatDollars(totalCents), R - 14 - 70, boxesY + 4, { width: 70, align: 'right' })
    }

    const totalY = showSubtotal ? boxesY + 22 : boxesY
    doc.rect(totalBoxX, totalY, totalBoxW, 38).strokeColor(RED).lineWidth(1.5).stroke()
    doc.font('Helvetica-Bold').fontSize(8).fillColor(RED)
       .text('TOTAL DUE', totalBoxX + 14, totalY + 7, { characterSpacing: 0.8 })
    doc.font('Helvetica-Bold').fontSize(15).fillColor(RED)
       .text(formatDollars(totalCents), R - 14 - 80, totalY + 4, { width: 80, align: 'right' })

    // ── Note ──────────────────────────────────────────────────────────
    let contentEndY = totalY + 38 + 14
    if (data.note) {
      contentEndY = totalY + 38 + 20
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(RED)
         .text('NOTE', L, contentEndY, { characterSpacing: 0.8 })
      doc.font('Helvetica').fontSize(9.5).fillColor(INK)
         .text(data.note, L, contentEndY + 12, { width: cW })
      contentEndY += 30 + (data.note.length > 100 ? 12 : 0)
    }

    // ── Payment instructions ───────────────────────────────────────────
    const payY = contentEndY + 18
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

// Stripe line descriptions can be verbose: "1 × Virtual Closer Base Build (at $XX / week)"
// Trim them to something clean for the invoice.
function cleanLineDescription(desc: string): string {
  // "N × Product Name (at $X.XX / interval)" → "N × Product Name"
  return desc.replace(/\s*\(at\s+\$[\d.,]+\s*\/\s*\w+\)/gi, '').trim()
}

export function makeInvoiceNumber(sessionId: string): string {
  const date = new Date()
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const suffix = sessionId.slice(-5).toUpperCase()
  return `VC-${ymd}-${suffix}`
}
