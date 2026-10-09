/**
 * Mira tool for QuickBooks Online (Suite CXO), read only.
 *
 *  - quickbooks_financials   "what was our net margin last quarter"
 *
 * Reads only the figures synced from the company's books into the
 * cxo_qbo_* tables. Never calls Intuit and never writes anything. Exec team
 * only (the same rule as comp): everyone else is told it is not available.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import { canSeeFinancials } from '@/lib/qbo/access'
import { getQboStatus, loadBreakdown, loadExpenseCategories, loadQboMonths } from '@/lib/qbo/data'
import { QBO_NOT_SET_UP, resolvePeriod, summarizeQboPeriod } from '@/lib/qbo/display'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })

const handle_quickbooks_financials: Handler = async (ctx, args) => {
  if (!canSeeFinancials(ctx.caller)) {
    return j({ ok: false, say: 'Company financials are for the executive team only.' })
  }
  const status = await getQboStatus(ctx.tenant.id)
  if (!status.configured) return j({ ok: false, say: `${QBO_NOT_SET_UP}. Once it is, an executive can connect it on Integrations.` })
  if (!status.connected) {
    return j({
      ok: false,
      say: status.needsReconnect
        ? 'QuickBooks access ended. An executive needs to reconnect it on Integrations.'
        : 'QuickBooks is not connected. An executive can connect it on Integrations (read only).',
    })
  }
  const period = resolvePeriod(typeof args.period === 'string' ? args.period : '', ctx.todayIso)
  const months = await loadQboMonths(ctx.tenant.id, period.from, period.to)
  const summary = summarizeQboPeriod(months, period)
  const breakdown = typeof args.breakdown === 'string' ? args.breakdown : ''
  const extra: Record<string, unknown> = {}
  if (breakdown === 'expenses') extra.expense_categories = (await loadExpenseCategories(ctx.tenant.id, period.from, period.to)).slice(0, 12)
  if (breakdown === 'customers') extra.top_customers = (await loadBreakdown(ctx.tenant.id, 'customer', period.from, period.to)).slice(0, 12)
  if (breakdown === 'classes') extra.classes = (await loadBreakdown(ctx.tenant.id, 'class', period.from, period.to)).slice(0, 12)
  return j({
    ok: true,
    source: 'QuickBooks Online (synced, read only)',
    company: status.companyName,
    environment: status.environment,
    last_synced_at: status.lastSyncAt,
    ...summary,
    no_data: summary.monthsCovered.length === 0,
    ...extra,
  })
}

export const CXO_QBO_TOOL_HANDLERS: Record<string, Handler> = {
  quickbooks_financials: handle_quickbooks_financials,
}

export const CXO_QBO_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'quickbooks_financials',
    description:
      'Actual company financials from the connected QuickBooks books (read only): "what was our net margin last quarter", "revenue this year", "biggest expenses last month". Returns revenue, cost of sales, gross profit, expenses, net income, gross and net margin % and the months covered for the period, plus an optional breakdown. Executive team only. Use only the returned figures; never estimate.',
    input_schema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'last_quarter (default), this_quarter, last_month, this_month, ytd, last_year, last_12_months, "q3 2026", "2026" or "2026-03".',
        },
        breakdown: { type: 'string', enum: ['expenses', 'customers', 'classes'], description: 'Optional breakdown for the same period.' },
      },
      additionalProperties: false,
    },
  },
]
