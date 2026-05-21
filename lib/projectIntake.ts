import type { NextRequest } from 'next/server'
import { extractDocText } from './extractText'

const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15 MB

export type ParsedProjectRequest =
  | { ok: true; source: string; sourceKind: 'prompt' | 'pdf' | 'docx' | 'manual'; titleHint?: string }
  | { ok: false; error: string; status: number }

/**
 * Parse a project-create / intake request body. Accepts either JSON
 * ({ prompt, title }) or multipart/form-data ({ file, prompt, title }). When a
 * file is present its text is extracted (pdf-parse / mammoth) and any typed
 * prompt is prepended to steer the plan. Shared by /api/projects and
 * /api/projects/intake so both read the upload identically.
 */
export async function parseProjectRequest(req: NextRequest): Promise<ParsedProjectRequest> {
  const contentType = req.headers.get('content-type') ?? ''
  let source = ''
  let titleHint: string | undefined
  let sourceKind: 'prompt' | 'pdf' | 'docx' | 'manual' = 'prompt'

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const prompt = (form.get('prompt') as string | null)?.trim() ?? ''
      titleHint = (form.get('title') as string | null)?.trim() || undefined
      const file = form.get('file')

      if (file && typeof file === 'object' && 'arrayBuffer' in file) {
        const f = file as File
        if (f.size > MAX_FILE_BYTES) return { ok: false, error: 'File too large (max 15 MB).', status: 413 }
        const buffer = Buffer.from(await f.arrayBuffer())
        const extracted = await extractDocText({ filename: f.name, mime: f.type, buffer })
        if (!extracted.text) return { ok: false, error: 'Could not read any text from that file.', status: 422 }
        sourceKind = extracted.kind === 'pdf' ? 'pdf' : extracted.kind === 'docx' ? 'docx' : 'prompt'
        source = prompt ? `${prompt}\n\n---\n\n${extracted.text}` : extracted.text
        if (!titleHint && f.name) titleHint = f.name.replace(/\.[^.]+$/, '')
      } else {
        source = prompt
      }
    } else {
      const body = (await req.json().catch(() => ({}))) as { prompt?: string; title?: string }
      source = (body.prompt ?? '').trim()
      titleHint = body.title?.trim() || undefined
    }
  } catch {
    return { ok: false, error: 'Could not parse request.', status: 400 }
  }

  source = source.trim()
  if (!source) return { ok: false, error: 'Add a prompt or upload a file to build a project.', status: 400 }
  return { ok: true, source, sourceKind, titleHint }
}
