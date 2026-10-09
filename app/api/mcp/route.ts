/**
 * /api/mcp — "Connect your AI" for Suite CXO.
 *
 * Streamable HTTP MCP endpoint (stateless, JSON responses). An executive's own
 * Claude or ChatGPT connects here with a key from the Integrations page and
 * can read every number on the dashboard and rearrange it.
 *
 * Auth: `Authorization: Bearer cxo_…` or `?k=cxo_…` (lib/mcp/auth.ts).
 * Unauthenticated → 401 JSON, never 500. Missing mcp_tokens table → 503 with
 * the migration to run.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { McpUnauthorized, requireMcpAuth, type McpAuthContext } from '@/lib/mcp/auth'
import { McpTokensNotReady } from '@/lib/mcp/tokens'
import { buildMcpServer } from '@/lib/mcp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function jsonError(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (status === 401) headers['www-authenticate'] = 'Bearer realm="suite-cxo-mcp"'
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null, ...extra }), { status, headers })
}

async function authenticate(req: Request): Promise<McpAuthContext | Response> {
  try {
    return await requireMcpAuth(req)
  } catch (err) {
    if (err instanceof McpUnauthorized) return jsonError(401, err.message)
    if (err instanceof McpTokensNotReady) return jsonError(503, err.message)
    const msg = err instanceof Error ? err.message : String(err)
    return jsonError(500, `Could not check the key: ${msg}`)
  }
}

async function handle(req: Request): Promise<Response> {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth

  const server = buildMcpServer(auth)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: every request stands alone
    enableJsonResponse: true, // plain JSON bodies; no long-lived SSE on a serverless route
  })
  try {
    await server.connect(transport)
    const res = await transport.handleRequest(req, {
      authInfo: { token: auth.tokenId, clientId: auth.member.id, scopes: ['cxo'], extra: { tenantId: auth.tenant.id } },
    })
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return jsonError(500, `MCP request failed: ${msg}`)
  } finally {
    // JSON mode: the response body is complete once handleRequest resolves.
    void transport.close().catch(() => {})
  }
}

export async function POST(req: Request) {
  return handle(req)
}

/** Stateless + JSON mode has no server→client stream; the transport answers 405 after auth. */
export async function GET(req: Request) {
  return handle(req)
}

export async function DELETE(req: Request) {
  return handle(req)
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version',
    },
  })
}
