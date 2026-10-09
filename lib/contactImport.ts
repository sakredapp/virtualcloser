/**
 * Browser-side parsing for the Partners directory import: CSV (with a
 * column-mapping step) and vCard (.vcf). Pure functions, no network; the
 * mapped rows go to POST /api/partners/import, which dedupes server-side.
 */

import type { PartnerInput, PartnerKind } from '@/lib/partnersShared'

export const IMPORT_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'org', label: 'Company' },
  { key: 'role', label: 'Role / title' },
  { key: 'kind', label: 'Type' },
  { key: 'email', label: 'Email' },
  { key: 'email_secondary', label: 'Second email' },
  { key: 'email_support', label: 'Support email' },
  { key: 'phone', label: 'Mobile phone' },
  { key: 'phone_office', label: 'Office phone' },
  { key: 'phone_office_ext', label: 'Office extension' },
  { key: 'website', label: 'Website' },
  { key: 'address', label: 'Address' },
  { key: 'tags', label: 'Tags' },
  { key: 'notes', label: 'Notes' },
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]['key']
/** field → CSV column index (-1 = not used). */
export type ColumnMap = Partial<Record<ImportField, number>>

/** RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF, commas or semicolons. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : (firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((v) => v.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((v) => v.trim())) rows.push(row)
  return rows.map((r) => r.map((v) => v.trim()))
}

const HEADER_GUESS: Array<[ImportField, RegExp]> = [
  ['first_name', /^(first|given)[ _-]?name$|^first$/i],
  ['last_name', /^(last|family|sur)[ _-]?name$|^last$|^surname$/i],
  ['email_support', /support|help ?desk/i],
  ['email_secondary', /(e-?mail|email address) ?(2|two)|second(ary)? e-?mail|other e-?mail|alt(ernate)? e-?mail/i],
  ['email', /e-?mail/i],
  ['phone_office_ext', /\bext(ension)?\b/i],
  ['phone_office', /office|work|business|direct|main|desk/i],
  ['phone', /mobile|cell|phone|tel/i],
  ['org', /company|organi[sz]ation|^org$|carrier|agency|employer|firm/i],
  ['role', /title|role|position|job/i],
  ['kind', /^type$|category|kind|contact type/i],
  ['website', /web|url|site/i],
  ['address', /address|street|city/i],
  ['tags', /tags?|product|line|labels?/i],
  ['notes', /notes?|comment|memo/i],
  ['name', /name|contact|full name/i],
]

/** Best-guess mapping from a header row. Each column is used at most once. */
export function guessMapping(header: string[]): ColumnMap {
  const map: ColumnMap = {}
  const used = new Set<number>()
  for (const [field, re] of HEADER_GUESS) {
    if (map[field] !== undefined) continue
    const idx = header.findIndex((h, i) => !used.has(i) && re.test(h))
    if (idx >= 0) {
      // Office-phone guesses must look like phones, not "Office location".
      if (field === 'phone_office' && !/phone|tel|number|direct|main/i.test(header[idx])) continue
      if (field === 'phone_office_ext' && !/ext/i.test(header[idx])) continue
      map[field] = idx
      used.add(idx)
    }
  }
  if (map.name !== undefined && (map.first_name !== undefined || map.last_name !== undefined) && /^(first|last)/i.test(header[map.name] ?? '')) delete map.name
  return map
}

/** "Carrier rep", "exec", "Vendor" → a stored kind; unknown → fallback. */
export function kindFromText(v: string | null | undefined, fallback: PartnerKind): PartnerKind {
  const s = (v ?? '').toLowerCase()
  if (!s) return fallback
  if (/exec|partner|principal|ceo|president|owner/.test(s)) return 'executive'
  if (/carrier|wholesal|underwrit|brokerage/.test(s)) return 'carrier'
  if (/vendor|supplier|service|software|tool/.test(s)) return 'vendor'
  if (/other/.test(s)) return 'other'
  return fallback
}

const splitTags = (v: string) => v.split(/[;,|]/).map((t) => t.trim()).filter(Boolean)

/** CSV rows (header removed) → contact inputs, by the mapping. */
export function rowsFromCsv(rows: string[][], map: ColumnMap, defaultKind: PartnerKind): PartnerInput[] {
  const get = (r: string[], f: ImportField) => {
    const i = map[f]
    return i === undefined || i < 0 ? '' : (r[i] ?? '').trim()
  }
  return rows.map((r) => {
    const name = get(r, 'name') || [get(r, 'first_name'), get(r, 'last_name')].filter(Boolean).join(' ')
    return {
      name,
      org: get(r, 'org') || null,
      role: get(r, 'role') || null,
      kind: kindFromText(get(r, 'kind'), defaultKind),
      email: get(r, 'email') || null,
      email_secondary: get(r, 'email_secondary') || null,
      email_support: get(r, 'email_support') || null,
      phone: get(r, 'phone') || null,
      phone_office: get(r, 'phone_office') || null,
      phone_office_ext: get(r, 'phone_office_ext') || null,
      website: get(r, 'website') || null,
      address: get(r, 'address') || null,
      tags: splitTags(get(r, 'tags')),
      notes: get(r, 'notes') || null,
    }
  })
}

/** vCard 2.1/3.0/4.0 → contact inputs. Unfolds lines, reads FN/N/ORG/TITLE/EMAIL/TEL/URL/ADR/NOTE/CATEGORIES. */
export function parseVcf(text: string, defaultKind: PartnerKind): PartnerInput[] {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1)
  const unesc = (v: string) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
  const out: PartnerInput[] = []
  for (const card of cards) {
    const lines = card.split('\n')
    let fn = ''
    let n = ''
    let org = ''
    let title = ''
    let url = ''
    let adr = ''
    let note = ''
    const tags: string[] = []
    const emails: Array<{ v: string; type: string }> = []
    const tels: Array<{ v: string; type: string }> = []
    for (const line of lines) {
      const m = line.match(/^(?:item\d+\.)?([A-Za-z-]+)((?:;[^:]*)?):(.*)$/)
      if (!m) continue
      const prop = m[1].toUpperCase()
      const params = m[2].toLowerCase()
      const val = m[3]
      if (prop === 'FN') fn = unesc(val)
      else if (prop === 'N') n = val.split(';').slice(0, 2).reverse().map(unesc).filter(Boolean).join(' ')
      else if (prop === 'ORG') org = val.split(';').map(unesc).filter(Boolean).join(', ')
      else if (prop === 'TITLE' || (prop === 'ROLE' && !title)) title = unesc(val)
      else if (prop === 'EMAIL') emails.push({ v: unesc(val), type: params })
      else if (prop === 'TEL') tels.push({ v: unesc(val.replace(/^tel:/i, '')), type: params })
      else if (prop === 'URL' && !url) url = unesc(val)
      else if (prop === 'ADR' && !adr) adr = val.split(';').map(unesc).filter(Boolean).join(', ')
      else if (prop === 'NOTE') note = unesc(val)
      else if (prop === 'CATEGORIES') tags.push(...val.split(',').map(unesc).filter(Boolean))
    }
    const pref = (list: Array<{ v: string; type: string }>) => list.find((e) => /pref/.test(e.type)) ?? list[0]
    const primaryEmail = pref(emails)
    const restEmails = emails.filter((e) => e !== primaryEmail)
    const support = restEmails.find((e) => /support|help/.test(e.v.toLowerCase()))
    const secondary = restEmails.find((e) => e !== support)
    const mobile = tels.find((t) => /cell|mobile|iphone/.test(t.type))
    const office = tels.find((t) => t !== mobile && /work|office|main|voice/.test(t.type)) ?? tels.find((t) => t !== mobile)
    const officeParts = office?.v.match(/^(.*?)(?:\s*(?:x|ext\.?|extension|;ext=)\s*(\d+))?$/i)
    out.push({
      name: fn || n,
      org: org || null,
      role: title || null,
      kind: defaultKind,
      email: primaryEmail?.v || null,
      email_secondary: secondary?.v || null,
      email_support: support?.v || null,
      phone: (mobile ?? (office ? undefined : tels[0]))?.v || null,
      phone_office: officeParts?.[1]?.trim() || null,
      phone_office_ext: officeParts?.[2] || null,
      website: url || null,
      address: adr || null,
      notes: note || null,
      tags,
    })
  }
  return out
}
