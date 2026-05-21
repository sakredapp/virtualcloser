import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'

export type SupportedDoc = {
  filename: string
  /** MIME type, when the upload provides one. */
  mime?: string | null
  buffer: Buffer
}

const MAX_CHARS = 120_000

/**
 * Extract plain text from an uploaded PDF, DOCX, or plain-text/markdown file.
 * Mirrors the dialer/roleplay knowledge-base ingestion path (pdf-parse for
 * PDFs, mammoth for DOCX). Returns trimmed text capped at MAX_CHARS so a giant
 * doc can't blow past the model's context or our token budget.
 */
export async function extractDocText(doc: SupportedDoc): Promise<{ text: string; kind: 'pdf' | 'docx' | 'text' }> {
  const name = doc.filename.toLowerCase()
  const mime = (doc.mime ?? '').toLowerCase()

  const isPdf = mime.includes('pdf') || name.endsWith('.pdf')
  const isDocx =
    mime.includes('word') ||
    mime.includes('officedocument.wordprocessingml') ||
    name.endsWith('.docx')

  if (isPdf) {
    const parser = new PDFParse({ data: new Uint8Array(doc.buffer) })
    try {
      const result = await parser.getText()
      return { text: clean(result.text), kind: 'pdf' }
    } finally {
      await parser.destroy().catch(() => {})
    }
  }

  if (isDocx) {
    const { value } = await mammoth.extractRawText({ buffer: doc.buffer })
    return { text: clean(value), kind: 'docx' }
  }

  // Fallback: treat as UTF-8 text (.txt, .md, or unknown).
  return { text: clean(doc.buffer.toString('utf8')), kind: 'text' }
}

function clean(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS)
}
