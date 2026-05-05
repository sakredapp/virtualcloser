// Generates a branded Virtual Closer invoice as a PDF Buffer using pdfkit.
// No browser / headless Chrome needed — pure Node.js.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit')

const RED    = '#FF2800'
const INK    = '#0F0F0F'
const PAPER  = '#FFFFFF'
const MUTED  = '#5A5A5A'
const LIGHT  = '#F7F4EF'
const BORDER = '#E0DACE'

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
    const doc = new PDFDocument({ size: 'LETTER', margin: 60, bufferPages: true })

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const W = doc.page.width   // 612
    const L = 60               // left margin
    const R = W - 60           // right edge
    const contentW = R - L     // 492

    // ── Red header band ────────────────────────────────────────────────
    doc.rect(0, 0, W, 110).fill(RED)

    // Company name
    doc.font('Helvetica-Bold').fontSize(22).fillColor(PAPER)
       .text('VIRTUAL CLOSER', L, 36, { width: contentW * 0.6 })

    doc.font('Helvetica').fontSize(11).fillColor('rgba(255,255,255,0.82)')
       .text('virtualcloser.com', L, 62)

    // "INVOICE" label — right side of header
    doc.font('Helvetica-Bold').fontSize(32).fillColor(PAPER)
       .text('INVOICE', L + contentW * 0.55, 30, { width: contentW * 0.45, align: 'right' })

    // Invoice # under header label
    doc.font('Helvetica').fontSize(10).fillColor('rgba(255,255,255,0.75)')
       .text(`#${data.invoiceNumber}`, L + contentW * 0.55, 72, { width: contentW * 0.45, align: 'right' })

    // ── Metadata row (issued / due) ────────────────────────────────────
    const metaY = 130
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
       .text('DATE ISSUED', L, metaY)
    doc.font('Helvetica').fontSize(11).fillColor(INK)
       .text(data.issuedDate, L, metaY + 14)

    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
       .text('DUE', L + 160, metaY)
    doc.font('Helvetica').fontSize(11).fillColor(INK)
       .text(data.dueDate, L + 160, metaY + 14)

    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
       .text('INVOICE #', L + 310, metaY)
    doc.font('Helvetica').fontSize(11).fillColor(INK)
       .text(data.invoiceNumber, L + 310, metaY + 14)

    // ── Divider ────────────────────────────────────────────────────────
    const divY = metaY + 42
    doc.moveTo(L, divY).lineTo(R, divY).strokeColor(BORDER).lineWidth(1).stroke()

    // ── Bill To / From ─────────────────────────────────────────────────
    const billingY = divY + 20
    const colW = contentW / 2 - 20

    // Bill To
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
       .text('BILL TO', L, billingY)
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK)
       .text(data.clientName, L, billingY + 14, { width: colW })
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
       .text(data.clientEmail, L, billingY + 30, { width: colW })

    // From
    const fromX = L + contentW / 2
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
       .text('FROM', fromX, billingY)
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK)
       .text('Virtual Closer', fromX, billingY + 14, { width: colW })
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
       .text('hello@virtualcloser.com', fromX, billingY + 30, { width: colW })

    // ── Line items table header ────────────────────────────────────────
    const tableY = billingY + 70
    doc.rect(L, tableY, contentW, 26).fill(INK)
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PAPER)
       .text('DESCRIPTION', L + 12, tableY + 8, { width: contentW * 0.65 })
    doc.text('AMOUNT', R - 80, tableY + 8, { width: 80, align: 'right' })

    // Line item row
    const rowY = tableY + 26
    const amount = formatDollars(data.lineItem.amountCents)

    doc.rect(L, rowY, contentW, 40).fill(LIGHT)
    doc.font('Helvetica').fontSize(11).fillColor(INK)
       .text(data.lineItem.description, L + 12, rowY + 12, { width: contentW * 0.65 })
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
       .text(amount, R - 80, rowY + 12, { width: 80, align: 'right' })

    // ── Total box ─────────────────────────────────────────────────────
    const totalY = rowY + 40 + 12
    doc.rect(L + contentW * 0.6, totalY, contentW * 0.4, 36).fill(RED)
    doc.font('Helvetica-Bold').fontSize(11).fillColor(PAPER)
       .text('TOTAL DUE', L + contentW * 0.6 + 14, totalY + 11)
    doc.font('Helvetica-Bold').fontSize(14).fillColor(PAPER)
       .text(amount, R - 80, totalY + 9, { width: 80, align: 'right' })

    // ── Note ──────────────────────────────────────────────────────────
    if (data.note) {
      const noteY = totalY + 60
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('NOTE', L, noteY)
      doc.font('Helvetica').fontSize(10).fillColor(INK)
         .text(data.note, L, noteY + 13, { width: contentW })
    }

    // ── Payment instructions ───────────────────────────────────────────
    const payY = data.note ? totalY + 120 : totalY + 60
    doc.moveTo(L, payY).lineTo(R, payY).strokeColor(BORDER).lineWidth(0.5).stroke()

    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
       .text('How to pay', L, payY + 14)
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
       .text('Click the secure payment link in your email, or copy this URL into your browser:', L, payY + 28, { width: contentW })
    doc.font('Helvetica').fontSize(9).fillColor(RED)
       .text(data.paymentUrl, L, payY + 46, { width: contentW, underline: true })

    // ── Footer ────────────────────────────────────────────────────────
    const footerY = doc.page.height - 54
    doc.rect(0, footerY, W, 54).fill(INK)
    doc.font('Helvetica').fontSize(9).fillColor('rgba(255,255,255,0.65)')
       .text(
         'Virtual Closer  ·  virtualcloser.com  ·  hello@virtualcloser.com  ·  Questions? Reply to this email.',
         L, footerY + 18,
         { width: contentW, align: 'center' },
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
