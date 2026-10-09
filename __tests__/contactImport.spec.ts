import { parseCsv, guessMapping, rowsFromCsv, parseVcf } from '@/lib/contactImport'
import { test, expect } from 'vitest'
test('CSV: quoted commas, first+last name, office ext', () => {
  const rows = parseCsv('First Name,Last Name,Company,Job Title,E-mail Address,Mobile Phone,Business Phone,Ext,Notes\n"Test","Person","Acme, Inc",Rep,t@x.io,555 111 2222,(555) 333-4444,12,"said ""hi"""\n')
  const m = guessMapping(rows[0])
  const out = rowsFromCsv(rows.slice(1), m, 'carrier')
  expect(out[0].name).toBe('Test Person')
  expect(out[0].org).toBe('Acme, Inc')
  expect(out[0].phone_office_ext).toBe('12')
})
test('vCard: support email and office extension', () => {
  const out = parseVcf('BEGIN:VCARD\nVERSION:3.0\nFN:Test Person\nORG:Acme;\nTITLE:Rep\nEMAIL;TYPE=WORK,PREF:t@x.io\nEMAIL:support@x.io\nTEL;TYPE=CELL:555-111-2222\nTEL;TYPE=WORK:555-333-4444 x9\nEND:VCARD\n', 'carrier')
  expect(out[0].email_support).toBe('support@x.io')
  expect(out[0].phone_office_ext).toBe('9')
})
test('searchWords: phone words become digits, wildcards escaped', async () => {
  const { searchWords } = await import('@/lib/partners')
  expect(searchWords('(402) 555-0141')).toEqual(['402', '5550141'])
  expect(searchWords('a%b_c')).toEqual(['a\\%b\\_c'])
})
