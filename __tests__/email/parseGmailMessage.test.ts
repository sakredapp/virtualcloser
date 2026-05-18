/**
 * Contract tests for parseGmailMessage() — the pure Gmail-API-to-internal-shape
 * converter that the email triage feature depends on.
 *
 * Pure TypeScript — no external test runner required.
 * Run with:  npx ts-node --project tsconfig.json __tests__/email/parseGmailMessage.test.ts
 *
 * These cover the messy parts: base64url body decoding, MIME multipart
 * traversal (text/plain vs text/html fallback), RFC 5322 address parsing
 * with display names and quoted parts, and the SENT/INBOX label
 * direction inference. If any of these silently break, the triage worker
 * starts persisting empty bodies or wrong sender addresses.
 */

import { parseGmailMessage, type GmailMessage } from '../../lib/google'

// ── Tiny harness ──────────────────────────────────────────────────────────

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
function test(name: string, fn: TestFn) { tests.push({ name, fn }) }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`Assertion failed: ${msg}`) }
function assertEq<T>(a: T, b: T, msg?: string) {
  if (a !== b) throw new Error(`${msg ?? 'assertEq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

// ── Helpers ──────────────────────────────────────────────────────────────

function b64url(s: string): string {
  return Buffer.from(s, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function mkMessage(opts: {
  id?: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  headers?: Array<[string, string]>
  bodyText?: string
  bodyHtml?: string
}): GmailMessage {
  const headers = (opts.headers ?? []).map(([name, value]) => ({ name, value }))
  // Build a multipart payload if both text and html are provided, otherwise single-part.
  let payload: GmailMessage['payload']
  if (opts.bodyText !== undefined && opts.bodyHtml !== undefined) {
    payload = {
      mimeType: 'multipart/alternative',
      headers,
      parts: [
        { mimeType: 'text/plain', body: { data: b64url(opts.bodyText) } },
        { mimeType: 'text/html', body: { data: b64url(opts.bodyHtml) } },
      ],
    }
  } else if (opts.bodyText !== undefined) {
    payload = {
      mimeType: 'text/plain',
      headers,
      body: { data: b64url(opts.bodyText) },
    }
  } else if (opts.bodyHtml !== undefined) {
    payload = {
      mimeType: 'text/html',
      headers,
      body: { data: b64url(opts.bodyHtml) },
    }
  } else {
    payload = { mimeType: 'text/plain', headers, body: {} }
  }

  return {
    id: opts.id ?? 'msg-1',
    threadId: opts.threadId ?? 'thread-1',
    labelIds: opts.labelIds ?? ['INBOX', 'UNREAD'],
    snippet: opts.snippet ?? '',
    internalDate: opts.internalDate ?? '1700000000000',
    payload,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

test('base64url body is decoded correctly (single-part text/plain)', () => {
  const msg = mkMessage({
    bodyText: 'Hello Spencer — quick question about the Q3 demo.',
    headers: [
      ['From', 'Dana <dana@example.com>'],
      ['Subject', 'Q3 demo follow-up'],
    ],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.bodyText, 'Hello Spencer — quick question about the Q3 demo.')
  assertEq(r.bodyHtml, null, 'bodyHtml should be null when only text/plain present')
})

test('multipart/alternative: both text and html bodies surfaced', () => {
  const msg = mkMessage({
    bodyText: 'Plain text version.',
    bodyHtml: '<p>HTML version.</p>',
    headers: [['From', 'a@b.com']],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.bodyText, 'Plain text version.')
  assertEq(r.bodyHtml, '<p>HTML version.</p>')
})

test('html-only message: bodyHtml present, bodyText null', () => {
  const msg = mkMessage({
    bodyHtml: '<p>Only HTML here.</p>',
    headers: [['From', 'x@y.com']],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.bodyHtml, '<p>Only HTML here.</p>')
  assertEq(r.bodyText, null)
})

test('From header with display name: extracts both name + address', () => {
  const msg = mkMessage({
    headers: [['From', '"Dana O\'Brien" <dana@example.com>']],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.fromAddress, 'dana@example.com')
  assertEq(r.fromName, "Dana O'Brien")
})

test('From header bare email: address extracted, name null', () => {
  const msg = mkMessage({
    headers: [['From', 'bare@example.com']],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.fromAddress, 'bare@example.com')
  assertEq(r.fromName, null)
})

test('Email addresses are lowercased', () => {
  const msg = mkMessage({
    headers: [['From', 'Dana <DANA@Example.COM>']],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.fromAddress, 'dana@example.com')
})

test('To header with multiple recipients: all extracted', () => {
  const msg = mkMessage({
    headers: [
      ['From', 'sender@example.com'],
      ['To', 'spencer@pinnacle.com, "Other Person" <other@example.com>'],
    ],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.toAddresses.length, 2, 'should parse 2 To addresses')
  assert(r.toAddresses.includes('spencer@pinnacle.com'), 'first To address present')
  assert(r.toAddresses.includes('other@example.com'), 'second To address present')
})

test('Cc header parsed', () => {
  const msg = mkMessage({
    headers: [
      ['From', 'a@b.com'],
      ['Cc', 'cc1@example.com, cc2@example.com'],
    ],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.ccAddresses.length, 2)
})

test('Subject preserved verbatim including punctuation', () => {
  const msg = mkMessage({
    headers: [
      ['From', 'a@b.com'],
      ['Subject', "Re: [URGENT] Spencer's quote — can you confirm?"],
    ],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.subject, "Re: [URGENT] Spencer's quote — can you confirm?")
})

test('Message-ID and References headers surfaced for threading', () => {
  const msg = mkMessage({
    headers: [
      ['From', 'a@b.com'],
      ['Message-ID', '<abc123@mail.example.com>'],
      ['References', '<root@mail.example.com> <reply1@mail.example.com>'],
    ],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.messageIdHeader, '<abc123@mail.example.com>')
  assertEq(r.referencesHeader, '<root@mail.example.com> <reply1@mail.example.com>')
})

test('Header lookup is case-insensitive', () => {
  // Gmail returns mixed-case header names ("From", "MESSAGE-ID", etc).
  const msg = mkMessage({
    headers: [
      ['from', 'a@b.com'],
      ['SUBJECT', 'lowercase from, uppercase subject'],
      ['Message-Id', '<id1@x.com>'],
    ],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.fromAddress, 'a@b.com')
  assertEq(r.subject, 'lowercase from, uppercase subject')
  assertEq(r.messageIdHeader, '<id1@x.com>')
})

test('Labels preserved', () => {
  const msg = mkMessage({ labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'] })
  const r = parseGmailMessage(msg)
  assertEq(r.labelIds.length, 3)
  assert(r.labelIds.includes('IMPORTANT'), 'IMPORTANT label preserved')
})

test('Outbound message (SENT label) recognizable', () => {
  // syncTick uses !labelIds.includes('SENT') to classify direction.
  // This test pins the contract: SENT must round-trip through labelIds.
  const msg = mkMessage({ labelIds: ['SENT'] })
  const r = parseGmailMessage(msg)
  assert(r.labelIds.includes('SENT'), 'SENT label survives parsing — direction-classification relies on this')
})

test('Empty payload: no crash, sensible defaults', () => {
  const msg: GmailMessage = {
    id: 'empty',
    threadId: 't',
    labelIds: [],
    snippet: '',
    internalDate: '0',
    payload: undefined,
  }
  const r = parseGmailMessage(msg)
  assertEq(r.subject, '')
  assertEq(r.fromAddress, '')
  assertEq(r.fromName, null)
  assertEq(r.bodyText, null)
  assertEq(r.bodyHtml, null)
  assertEq(r.toAddresses.length, 0)
})

test('Missing From header: empty string, no throw', () => {
  const msg = mkMessage({
    headers: [['Subject', 'no sender']],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.fromAddress, '')
  assertEq(r.fromName, null)
})

test('Unicode body content decodes correctly', () => {
  // Real customer emails have emoji + accented characters. base64 round-trip
  // should preserve them exactly.
  const msg = mkMessage({
    bodyText: 'Bonjour — café ☕ é à ñ 中文 🎉',
    headers: [['From', 'a@b.com']],
  })
  const r = parseGmailMessage(msg)
  assertEq(r.bodyText, 'Bonjour — café ☕ é à ñ 中文 🎉')
})

// ── Runner ────────────────────────────────────────────────────────────────

async function main() {
  let pass = 0
  let fail = 0
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
      pass++
    } catch (err) {
      console.error(`  ✗ ${name}`)
      console.error(`      ${(err as Error).message}`)
      fail++
    }
  }
  console.log(`\n${pass} passed, ${fail} failed (of ${tests.length} total)`)
  process.exit(fail > 0 ? 1 : 0)
}

main()
