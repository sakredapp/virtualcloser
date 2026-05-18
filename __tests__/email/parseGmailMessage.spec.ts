/**
 * Contract tests for parseGmailMessage() — the pure Gmail-API-to-internal-shape
 * converter the email triage feature depends on.
 *
 * Covers base64url body decoding, multipart/alternative traversal, RFC 5322
 * From/To/Cc parsing with display names, case-insensitive header lookup,
 * Message-ID + References for threading, SENT/INBOX label round-trip, and
 * unicode preservation. If any of these silently break, the triage worker
 * starts persisting empty bodies or wrong sender addresses.
 */

import { describe, expect, test } from 'vitest'
import { parseGmailMessage, type GmailMessage } from '../../lib/google'

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

describe('parseGmailMessage', () => {
  test('base64url body decodes correctly (single-part text/plain)', () => {
    const msg = mkMessage({
      bodyText: 'Hello Spencer — quick question about the Q3 demo.',
      headers: [
        ['From', 'Dana <dana@example.com>'],
        ['Subject', 'Q3 demo follow-up'],
      ],
    })
    const r = parseGmailMessage(msg)
    expect(r.bodyText).toBe('Hello Spencer — quick question about the Q3 demo.')
    expect(r.bodyHtml).toBeNull()
  })

  test('multipart/alternative surfaces both text and html bodies', () => {
    const msg = mkMessage({
      bodyText: 'Plain text version.',
      bodyHtml: '<p>HTML version.</p>',
      headers: [['From', 'a@b.com']],
    })
    const r = parseGmailMessage(msg)
    expect(r.bodyText).toBe('Plain text version.')
    expect(r.bodyHtml).toBe('<p>HTML version.</p>')
  })

  test('html-only message: bodyHtml present, bodyText null', () => {
    const msg = mkMessage({
      bodyHtml: '<p>Only HTML here.</p>',
      headers: [['From', 'x@y.com']],
    })
    const r = parseGmailMessage(msg)
    expect(r.bodyHtml).toBe('<p>Only HTML here.</p>')
    expect(r.bodyText).toBeNull()
  })

  test('From header with display name extracts both name + address', () => {
    const msg = mkMessage({
      headers: [['From', '"Dana O\'Brien" <dana@example.com>']],
    })
    const r = parseGmailMessage(msg)
    expect(r.fromAddress).toBe('dana@example.com')
    expect(r.fromName).toBe("Dana O'Brien")
  })

  test('From header bare email: address extracted, name null', () => {
    const msg = mkMessage({
      headers: [['From', 'bare@example.com']],
    })
    const r = parseGmailMessage(msg)
    expect(r.fromAddress).toBe('bare@example.com')
    expect(r.fromName).toBeNull()
  })

  test('email addresses are lowercased', () => {
    const msg = mkMessage({
      headers: [['From', 'Dana <DANA@Example.COM>']],
    })
    const r = parseGmailMessage(msg)
    expect(r.fromAddress).toBe('dana@example.com')
  })

  test('To header with multiple recipients is fully parsed', () => {
    const msg = mkMessage({
      headers: [
        ['From', 'sender@example.com'],
        ['To', 'spencer@pinnacle.com, "Other Person" <other@example.com>'],
      ],
    })
    const r = parseGmailMessage(msg)
    expect(r.toAddresses).toHaveLength(2)
    expect(r.toAddresses).toContain('spencer@pinnacle.com')
    expect(r.toAddresses).toContain('other@example.com')
  })

  test('Cc header parsed into ccAddresses', () => {
    const msg = mkMessage({
      headers: [
        ['From', 'a@b.com'],
        ['Cc', 'cc1@example.com, cc2@example.com'],
      ],
    })
    const r = parseGmailMessage(msg)
    expect(r.ccAddresses).toHaveLength(2)
  })

  test('Subject preserved verbatim including punctuation and unicode', () => {
    const msg = mkMessage({
      headers: [
        ['From', 'a@b.com'],
        ['Subject', "Re: [URGENT] Spencer's quote — can you confirm?"],
      ],
    })
    const r = parseGmailMessage(msg)
    expect(r.subject).toBe("Re: [URGENT] Spencer's quote — can you confirm?")
  })

  test('Message-ID and References surfaced for threading', () => {
    const msg = mkMessage({
      headers: [
        ['From', 'a@b.com'],
        ['Message-ID', '<abc123@mail.example.com>'],
        ['References', '<root@mail.example.com> <reply1@mail.example.com>'],
      ],
    })
    const r = parseGmailMessage(msg)
    expect(r.messageIdHeader).toBe('<abc123@mail.example.com>')
    expect(r.referencesHeader).toBe('<root@mail.example.com> <reply1@mail.example.com>')
  })

  test('header lookup is case-insensitive', () => {
    const msg = mkMessage({
      headers: [
        ['from', 'a@b.com'],
        ['SUBJECT', 'lowercase from, uppercase subject'],
        ['Message-Id', '<id1@x.com>'],
      ],
    })
    const r = parseGmailMessage(msg)
    expect(r.fromAddress).toBe('a@b.com')
    expect(r.subject).toBe('lowercase from, uppercase subject')
    expect(r.messageIdHeader).toBe('<id1@x.com>')
  })

  test('labels preserved', () => {
    const msg = mkMessage({ labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'] })
    const r = parseGmailMessage(msg)
    expect(r.labelIds).toHaveLength(3)
    expect(r.labelIds).toContain('IMPORTANT')
  })

  test('SENT label survives parsing (direction classification depends on this)', () => {
    const msg = mkMessage({ labelIds: ['SENT'] })
    const r = parseGmailMessage(msg)
    expect(r.labelIds).toContain('SENT')
  })

  test('empty payload yields sensible defaults without throwing', () => {
    const msg: GmailMessage = {
      id: 'empty',
      threadId: 't',
      labelIds: [],
      snippet: '',
      internalDate: '0',
      payload: undefined,
    }
    const r = parseGmailMessage(msg)
    expect(r.subject).toBe('')
    expect(r.fromAddress).toBe('')
    expect(r.fromName).toBeNull()
    expect(r.bodyText).toBeNull()
    expect(r.bodyHtml).toBeNull()
    expect(r.toAddresses).toHaveLength(0)
  })

  test('missing From header yields empty fromAddress without throwing', () => {
    const msg = mkMessage({
      headers: [['Subject', 'no sender']],
    })
    const r = parseGmailMessage(msg)
    expect(r.fromAddress).toBe('')
    expect(r.fromName).toBeNull()
  })

  test('unicode + emoji body content decodes correctly', () => {
    const msg = mkMessage({
      bodyText: 'Bonjour — café ☕ é à ñ 中文 🎉',
      headers: [['From', 'a@b.com']],
    })
    const r = parseGmailMessage(msg)
    expect(r.bodyText).toBe('Bonjour — café ☕ é à ñ 中文 🎉')
  })
})
