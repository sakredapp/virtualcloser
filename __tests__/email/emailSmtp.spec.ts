import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Self-hosted box mail (selfhost/): sendEmail goes through the client's SMTP
// only when SELFHOST=1 and SMTP_HOST is set; Vercel keeps Resend.
const sendMail = vi.fn(async () => ({ messageId: '<m1@box>' }))
const createTransport = vi.fn(() => ({ sendMail }))
vi.mock('nodemailer', () => ({ default: { createTransport } }))
const resendSend = vi.fn(async () => ({ data: { id: 'r1' }, error: null }))
vi.mock('resend', () => ({ Resend: class { emails = { send: resendSend } } }))

const KEYS = ['SELFHOST', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_REPLY_TO', 'SMTP_SECURE', 'RESEND_API_KEY', 'CXO_RESEND_API_KEY']
let saved: Record<string, string | undefined>
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
  sendMail.mockClear(); createTransport.mockClear(); resendSend.mockClear()
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('smtpConfig', () => {
  it('is off unless SELFHOST=1 and SMTP_HOST are both set', async () => {
    const { smtpConfig } = await import('@/lib/emailSmtp')
    expect(smtpConfig({ SMTP_HOST: 'smtp.office365.com' })).toBeNull()
    expect(smtpConfig({ SELFHOST: '1' })).toBeNull()
    expect(smtpConfig({ SELFHOST: '1', SMTP_HOST: 'smtp.office365.com' })).not.toBeNull()
  })

  it('defaults From to the SMTP user and reply-to to the From address', async () => {
    const { smtpConfig } = await import('@/lib/emailSmtp')
    const c = smtpConfig({ SELFHOST: '1', SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'ciao@acme.com', SMTP_PASS: 'x' })!
    expect(c).toMatchObject({ port: 587, secure: false, from: 'Suite CXO <ciao@acme.com>', replyTo: 'ciao@acme.com' })
    const d = smtpConfig({ SELFHOST: '1', SMTP_HOST: 'mx', SMTP_PORT: '465', SMTP_FROM: 'Ciao <ciao@acme.com>', SMTP_REPLY_TO: 'it@acme.com' })!
    expect(d).toMatchObject({ port: 465, secure: true, from: 'Ciao <ciao@acme.com>', replyTo: 'it@acme.com' })
  })
})

describe('sendEmail transport choice', () => {
  it('sends through SMTP on a box, never Resend', async () => {
    Object.assign(process.env, { SELFHOST: '1', SMTP_HOST: 'mailpit', SMTP_PORT: '1025', SMTP_FROM: 'Ciao <ciao@acme.com>', RESEND_API_KEY: 're_x' })
    const { sendEmail } = await import('@/lib/email')
    const r = await sendEmail({ brand: 'cxo', to: 'a@acme.com', subject: 's', html: '<p>h</p>' })
    expect(r).toEqual({ ok: true, id: '<m1@box>' })
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'mailpit', port: 1025, auth: undefined }))
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'Ciao <ciao@acme.com>', to: 'a@acme.com', replyTo: 'ciao@acme.com' }))
    expect(resendSend).not.toHaveBeenCalled()
  })

  it('keeps Resend in the cloud even if SMTP_HOST is set', async () => {
    Object.assign(process.env, { SMTP_HOST: 'smtp.office365.com', RESEND_API_KEY: 're_x' })
    const { sendEmail } = await import('@/lib/email')
    const r = await sendEmail({ brand: 'cxo', to: 'a@acme.com', subject: 's', html: '<p>h</p>' })
    expect(r.ok).toBe(true)
    expect(resendSend).toHaveBeenCalledOnce()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('reports an SMTP failure instead of throwing', async () => {
    Object.assign(process.env, { SELFHOST: '1', SMTP_HOST: 'mx' })
    sendMail.mockRejectedValueOnce(new Error('535 auth failed'))
    const { sendEmail } = await import('@/lib/email')
    const r = await sendEmail({ brand: 'cxo', to: 'a@acme.com', subject: 's', html: '<p>h</p>' })
    expect(r).toEqual({ ok: false, error: '535 auth failed' })
  })
})

describe('one SMTP choke point', () => {
  it('only lib/emailSmtp.ts imports nodemailer', () => {
    const root = path.resolve(__dirname, '../..')
    const files: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(f)) files.push(p)
      }
    }
    for (const d of ['app', 'lib', 'components', 'hetzner-worker']) {
      try { walk(path.join(root, d)) } catch { /* may not exist */ }
    }
    const offenders = files
      .filter((f) => /from ['"]nodemailer['"]|require\(['"]nodemailer['"]\)/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f).split(path.sep).join('/'))
    expect(offenders).toEqual(['lib/emailSmtp.ts'])
  })
})
