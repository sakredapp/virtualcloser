/**
 * Assistant name setting (owner 2026-10-17): a company renames its AI
 * assistant (reps.settings.assistant_name), a person can pick their own
 * (members.settings.assistant_name). Person → company → 'Ciao'.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── a tiny in-memory reps / members table ──
const db: Record<string, Record<string, { settings: Record<string, unknown> | null }>> = { reps: {}, members: {} }
const writes: Array<{ table: string; id: string; settings: Record<string, unknown> }> = []
function from(table: string) {
  let patch: Record<string, unknown> | null = null
  const q = {
    select: () => q,
    update: (p: Record<string, unknown>) => { patch = p; return q },
    eq: (_col: string, id: string) => {
      if (patch) {
        const settings = patch.settings as Record<string, unknown>
        db[table][id] = { ...(db[table][id] ?? {}), settings }
        writes.push({ table, id, settings })
        return Promise.resolve({ data: null, error: null })
      }
      return { maybeSingle: async () => ({ data: db[table][id] ?? null, error: null }) }
    },
  }
  return q
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => from(t) } }))

type Ctx = { tenant: { id: string; settings: Record<string, unknown> }; member: { id: string; role: string; settings: Record<string, unknown>; acting_assistant?: { id: string } | null } }
let ctx: Ctx
vi.mock('@/lib/cxoAccess', () => {
  class NotExec extends Error {}
  return { NotExec, requireOrgMember: async () => ctx }
})

import {
  ASSISTANT_NAME,
  readAssistantNameSetting,
  resolveAssistantName,
  validateAssistantName,
  withAssistantName,
} from '@/lib/assistantName'
import { assistantNameFor, assistantNameForIds, canEditCompanyAssistantName } from '@/lib/assistantNameServer'
import { employeePathAllowed } from '@/lib/employees/access'

beforeEach(() => {
  db.reps = { rep1: { settings: { other: 1 } } }
  db.members = { m_owner: { settings: {} }, m_emp: { settings: {} }, m_ea: { settings: { assistant_name: 'Penny' } } }
  writes.length = 0
})

describe('validateAssistantName', () => {
  it('trims and collapses spaces', () => {
    expect(validateAssistantName('  Mary   Jo  ')).toEqual({ ok: true, name: 'Mary Jo' })
  })
  it('accepts letters, spaces, hyphens and apostrophes, any script', () => {
    for (const n of ["O'Neil", 'Anne-Marie', 'José', 'Zoë Ray', 'O’Hara']) expect(validateAssistantName(n)).toEqual({ ok: true, name: n })
  })
  it('empty or missing clears the setting', () => {
    expect(validateAssistantName('')).toEqual({ ok: true, name: null })
    expect(validateAssistantName('   ')).toEqual({ ok: true, name: null })
    expect(validateAssistantName(null)).toEqual({ ok: true, name: null })
    expect(validateAssistantName(undefined)).toEqual({ ok: true, name: null })
  })
  it('allows 24 characters, refuses 25', () => {
    expect(validateAssistantName('a'.repeat(24)).ok).toBe(true)
    expect(validateAssistantName('a'.repeat(25)).ok).toBe(false)
  })
  it('refuses digits, symbols, markup and a leading hyphen', () => {
    for (const n of ['R2D2', 'Ciao!', '<b>x</b>', '-Ann', "'Ann", 'a_b', 'Ann.']) expect(validateAssistantName(n).ok).toBe(false)
  })
  it('refuses non-text', () => {
    expect(validateAssistantName(42).ok).toBe(false)
    expect(validateAssistantName({}).ok).toBe(false)
  })
})

describe('resolveAssistantName', () => {
  it('person → company → default', () => {
    expect(resolveAssistantName({ personal: 'Penny', company: 'Ava' })).toBe('Penny')
    expect(resolveAssistantName({ personal: null, company: 'Ava' })).toBe('Ava')
    expect(resolveAssistantName({})).toBe(ASSISTANT_NAME)
    expect(ASSISTANT_NAME).toBe('Ciao')
  })
  it('skips an invalid stored value', () => {
    expect(resolveAssistantName({ personal: '<script>', company: 'Ava' })).toBe('Ava')
    expect(readAssistantNameSetting({ assistant_name: 'x'.repeat(40) })).toBeNull()
    expect(readAssistantNameSetting({ assistant_name: ' Ava ' })).toBe('Ava')
    expect(readAssistantNameSetting(null)).toBeNull()
  })
})

describe('withAssistantName', () => {
  it('swaps the default as a whole word only', () => {
    expect(withAssistantName('Ciao drafted this. Ciaociao stays.', 'Ava')).toBe('Ava drafted this. Ciaociao stays.')
    expect(withAssistantName('Ciao drafted this.', ASSISTANT_NAME)).toBe('Ciao drafted this.')
  })
})

describe('server resolver', () => {
  it('only an owner or admin, signed in as themself, edits the company name', () => {
    expect(canEditCompanyAssistantName({ role: 'owner' })).toBe(true)
    expect(canEditCompanyAssistantName({ role: 'admin' })).toBe(true)
    expect(canEditCompanyAssistantName({ role: 'manager' })).toBe(false)
    expect(canEditCompanyAssistantName({ role: 'rep' })).toBe(false)
    expect(canEditCompanyAssistantName({ role: 'owner', acting_assistant: { id: 'm_ea' } })).toBe(false)
    expect(canEditCompanyAssistantName(null)).toBe(false)
  })
  it('assistantNameFor: own pick, then company, then default', async () => {
    expect(await assistantNameFor({ tenant: { settings: { assistant_name: 'Ava' } }, member: { settings: { assistant_name: 'Penny' } } })).toBe('Penny')
    expect(await assistantNameFor({ tenant: { settings: { assistant_name: 'Ava' } }, member: { settings: {} } })).toBe('Ava')
    expect(await assistantNameFor({ tenant: { settings: {} }, member: null })).toBe('Ciao')
    expect(await assistantNameFor(null)).toBe('Ciao')
  })
  it('an exec assistant working as their exec keeps their own pick, not the exec’s', async () => {
    const name = await assistantNameFor({ tenant: { settings: { assistant_name: 'Ava' } }, member: { settings: { assistant_name: 'ExecPick' }, acting_assistant: { id: 'm_ea' } } })
    expect(name).toBe('Penny')
  })
  it('assistantNameForIds reads the rows for background work', async () => {
    db.reps.rep1.settings = { assistant_name: 'Ava' }
    expect(await assistantNameForIds('rep1')).toBe('Ava')
    expect(await assistantNameForIds('rep1', 'm_ea')).toBe('Penny')
    expect(await assistantNameForIds('rep1', 'm_emp')).toBe('Ava')
    expect(await assistantNameForIds(null)).toBe('Ciao')
  })
})

async function put(body: unknown) {
  const { PUT } = await import('@/app/api/me/assistant-name/route')
  return PUT(new Request('http://x/api/me/assistant-name', { method: 'PUT', body: JSON.stringify(body) }))
}

describe('/api/me/assistant-name', () => {
  it('GET returns company, personal, resolved and who may edit', async () => {
    ctx = { tenant: { id: 'rep1', settings: { assistant_name: 'Ava' } }, member: { id: 'm_emp', role: 'rep', settings: { assistant_name: 'Jo' } } }
    const { GET } = await import('@/app/api/me/assistant-name/route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ company: 'Ava', personal: 'Jo', resolved: 'Jo', canEditCompany: false })
  })
  it('owner saves the company name, keeping other settings', async () => {
    ctx = { tenant: { id: 'rep1', settings: {} }, member: { id: 'm_owner', role: 'owner', settings: {} } }
    const res = await put({ scope: 'company', name: '  Ava  ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ company: 'Ava', personal: null, resolved: 'Ava', canEditCompany: true })
    expect(db.reps.rep1.settings).toEqual({ other: 1, assistant_name: 'Ava' })
  })
  it('admin may, employee and manager may not change the company name', async () => {
    ctx = { tenant: { id: 'rep1', settings: {} }, member: { id: 'm_owner', role: 'admin', settings: {} } }
    expect((await put({ scope: 'company', name: 'Ava' })).status).toBe(200)
    for (const role of ['rep', 'manager', 'observer', 'assistant']) {
      writes.length = 0
      ctx = { tenant: { id: 'rep1', settings: {} }, member: { id: 'm_emp', role, settings: {} } }
      const res = await put({ scope: 'company', name: 'Bob' })
      expect(res.status).toBe(403)
      expect(writes).toEqual([])
    }
  })
  it('an exec assistant working as an owner cannot change the company name', async () => {
    ctx = { tenant: { id: 'rep1', settings: {} }, member: { id: 'm_owner', role: 'owner', settings: {}, acting_assistant: { id: 'm_ea' } } }
    expect((await put({ scope: 'company', name: 'Bob' })).status).toBe(403)
    expect(writes).toEqual([])
  })
  it('clearing the company name removes the key', async () => {
    db.reps.rep1.settings = { other: 1, assistant_name: 'Ava' }
    ctx = { tenant: { id: 'rep1', settings: { assistant_name: 'Ava' } }, member: { id: 'm_owner', role: 'owner', settings: {} } }
    const res = await put({ scope: 'company', name: '' })
    expect(await res.json()).toMatchObject({ company: null, resolved: 'Ciao' })
    expect(db.reps.rep1.settings).toEqual({ other: 1 })
  })
  it('anyone saves their own name, on their own row only', async () => {
    ctx = { tenant: { id: 'rep1', settings: { assistant_name: 'Ava' } }, member: { id: 'm_emp', role: 'rep', settings: {} } }
    const res = await put({ scope: 'personal', name: 'Jo' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ company: 'Ava', personal: 'Jo', resolved: 'Jo', canEditCompany: false })
    expect(writes).toEqual([{ table: 'members', id: 'm_emp', settings: { assistant_name: 'Jo' } }])
  })
  it('an exec assistant working as their exec saves to their own row', async () => {
    ctx = { tenant: { id: 'rep1', settings: {} }, member: { id: 'm_owner', role: 'owner', settings: {}, acting_assistant: { id: 'm_ea' } } }
    await put({ scope: 'personal', name: 'Max' })
    expect(writes.map((w) => `${w.table}:${w.id}`)).toEqual(['members:m_ea'])
  })
  it('clearing your own name falls back to the company name', async () => {
    db.members.m_emp.settings = { assistant_name: 'Jo', title: 'Analyst' }
    ctx = { tenant: { id: 'rep1', settings: { assistant_name: 'Ava' } }, member: { id: 'm_emp', role: 'rep', settings: { assistant_name: 'Jo' } } }
    const res = await put({ scope: 'personal', name: '  ' })
    expect(await res.json()).toEqual({ company: 'Ava', personal: null, resolved: 'Ava', canEditCompany: false })
    expect(db.members.m_emp.settings).toEqual({ title: 'Analyst' })
  })
  it('refuses a bad name or a missing scope and saves nothing', async () => {
    ctx = { tenant: { id: 'rep1', settings: {} }, member: { id: 'm_owner', role: 'owner', settings: {} } }
    const bad = await put({ scope: 'personal', name: 'R2-D2' })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/letters/)
    expect((await put({ scope: 'company', name: 'x'.repeat(30) })).status).toBe(400)
    expect((await put({ name: 'Ava' })).status).toBe(400)
    expect(writes).toEqual([])
  })
  it('employee logins may reach the route (their own name only)', () => {
    expect(employeePathAllowed('/api/me/assistant-name')).toBe(true)
  })
})
