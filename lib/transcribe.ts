/**
 * Telegram voice/audio → text via OpenAI Whisper.
 * Cheap (~$0.006/min) and high quality for English sales chatter.
 */

const OPENAI_API = 'https://api.openai.com/v1'
const TG_API = 'https://api.telegram.org'

export async function transcribeTelegramVoice(fileId: string): Promise<string | null> {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN
  const oaiKey = process.env.OPENAI_API_KEY
  if (!tgToken || !oaiKey) return null

  // 1) Resolve file_path from Telegram.
  const fileRes = await fetch(`${TG_API}/bot${tgToken}/getFile?file_id=${encodeURIComponent(fileId)}`)
  if (!fileRes.ok) return null
  const fileJson = (await fileRes.json()) as { ok?: boolean; result?: { file_path?: string } }
  const filePath = fileJson?.result?.file_path
  if (!filePath) return null

  // 2) Download the audio.
  const audioRes = await fetch(`${TG_API}/file/bot${tgToken}/${filePath}`)
  if (!audioRes.ok) return null
  const audioBuf = await audioRes.arrayBuffer()

  // 3) Send to Whisper. Telegram voice messages are .ogg (Opus).
  const ext = filePath.split('.').pop()?.toLowerCase() || 'ogg'
  const mime =
    ext === 'mp3' ? 'audio/mpeg' :
    ext === 'm4a' ? 'audio/mp4' :
    ext === 'wav' ? 'audio/wav' :
    ext === 'webm' ? 'audio/webm' :
    'audio/ogg'
  const form = new FormData()
  form.append('file', new Blob([audioBuf], { type: mime }), `voice.${ext}`)
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1')
  form.append('response_format', 'text')

  const oaiRes = await fetch(`${OPENAI_API}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${oaiKey}` },
    body: form,
  })
  if (!oaiRes.ok) {
    const errText = await oaiRes.text().catch(() => '')
    console.error('[whisper] transcription failed', oaiRes.status, errText)
    return null
  }
  const text = (await oaiRes.text()).trim()
  return text || null
}
