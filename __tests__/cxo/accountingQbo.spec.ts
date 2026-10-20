/**
 * Accounting keeps QuickBooks (owner 2026-10-20): the connect panel is on the
 * Accounting overview, the round trip comes back to Accounting, and the
 * ?qbo= flag becomes one plain line. Pure: reads source files, no network.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { qboFlashLine, QBO_NOT_SET_UP } from '@/lib/qbo/display'
import { cxoPathAllowed } from '@/lib/cxoRoutes'

const page = readFileSync(join(process.cwd(), 'app/dashboard/accounting/page.tsx'), 'utf8')

describe('QuickBooks on Accounting', () => {
  it('the overview shows the QuickBooks panel and returns to Accounting', () => {
    expect(page).toContain("import QboPanel from '@/app/components/cxo/QboPanel'")
    expect(page).toContain('returnPath="/dashboard/accounting"')
    expect(page).toMatch(/canSeeFinancials\(ctx\.member\)/)
    expect(cxoPathAllowed('/dashboard/accounting')).toBe(true)
  })

  it('every flag the routes send has a line; unknown flags show nothing', () => {
    for (const f of ['connected', 'connected_sync_pending', 'disconnected']) expect(qboFlashLine(f)?.tone, f).toBe('ok')
    for (const f of ['cancelled', 'not_allowed', 'not_set_up', 'error']) expect(qboFlashLine(f)?.tone, f).toBe('warn')
    expect(qboFlashLine('not_set_up')?.text).toContain(QBO_NOT_SET_UP)
    expect(qboFlashLine(undefined)).toBeNull()
    expect(qboFlashLine('<script>')).toBeNull()
  })

  it('the routes only send flags we have a line for', () => {
    const routes = ['start', 'callback', 'disconnect'].map((r) => readFileSync(join(process.cwd(), `app/api/integrations/quickbooks/${r}/route.ts`), 'utf8')).join('\n')
    const sent = new Set([...routes.matchAll(/qbo=([a-z_]+)|back\('([a-z_]+)'\)/g)].map((m) => m[1] || m[2]))
    sent.add('connected').add('connected_sync_pending')
    for (const f of sent) expect(qboFlashLine(f), f).not.toBeNull()
  })
})
