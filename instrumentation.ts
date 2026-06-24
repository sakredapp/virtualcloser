// Global server-error capture. Next 15's onRequestError fires for EVERY
// uncaught error across route handlers, server components, and server actions —
// so unexpected failures land in app_errors (and page on fatal) instead of
// vanishing into the Vercel function log. One hook covers all 167 routes.
//
// Note: this only sees UNCAUGHT errors. Routes that try/catch and return their
// own response are "handled" and won't reach here by design — that's why the
// inbound webhooks (where a swallowed failure silently drops external data)
// call logError directly in their catch blocks.

import type { Instrumentation } from 'next'

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  try {
    const { logError } = await import('@/lib/errors')
    const path = request?.path ?? 'unknown'
    const method = request?.method ?? ''
    // Route handlers / server actions are real failures; treat them as 'error'.
    // (Render errors still get logged but aren't paged unless fatal.)
    await logError({
      source: `route${context?.routePath ? `:${context.routePath}` : `:${path}`}`,
      errorType: `unhandled_${context?.routeType ?? 'request'}`,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      context: {
        path,
        method,
        routerKind: context?.routerKind,
        routeType: context?.routeType,
        renderSource: context?.renderSource,
      },
    })
  } catch {
    // Never let diagnostics break the error path.
  }
}
