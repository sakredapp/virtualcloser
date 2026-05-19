// Server-Sent Events endpoint for the live Email Triage inbox.
//
// The browser opens an EventSource to this route. Server-side we hold an
// open Supabase Realtime subscription on email_threads + email_drafts
// filtered to the viewer's rep_id, and forward each change event to the
// client as a tiny JSON ping. The client uses the ping as a signal to
// `router.refresh()` — we don't try to surgically merge in new rows on the
// client, the server-rendered list is the source of truth.
//
// Subscription teardown: when the client closes the connection, we
// unsubscribe and remove the channel so we don't leak handles.

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireMember } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Vercel default function timeout is 300s. SSE will hit it; EventSource
// auto-reconnects, so the client sees ~1s gap every 5 min — acceptable
// for a "live inbox" feel.
export const maxDuration = 300

export async function GET(_req: NextRequest) {
  let viewerRepId: string
  try {
    const { tenant } = await requireMember()
    viewerRepId = tenant.id
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }

  // Use a fresh client per stream so each subscription has its own
  // realtime connection; closing the response detaches cleanly.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return new Response('Supabase env missing', { status: 500 })
  }
  const client = createClient(url, key, {
    realtime: { params: { eventsPerSecond: 5 } },
  })

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Stream already closed by client; ignore.
        }
      }

      // Initial hello so the browser confirms the stream is alive.
      send({ type: 'hello', ts: Date.now() })

      const channel = client
        .channel(`inbox-${viewerRepId}-${Date.now()}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'email_threads',
            filter: `rep_id=eq.${viewerRepId}`,
          },
          (payload) => send({ type: 'thread', event: payload.eventType }),
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'email_drafts',
            filter: `rep_id=eq.${viewerRepId}`,
          },
          (payload) => send({ type: 'draft', event: payload.eventType }),
        )
        .subscribe()

      // Heartbeat every 25 seconds so proxies don't close the connection.
      const heartbeat = setInterval(() => send({ type: 'ping', ts: Date.now() }), 25_000)

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        client.removeChannel(channel).catch(() => {})
        try { controller.close() } catch {}
      }

      // Tear down when client disconnects.
      _req.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Disable Next.js + Vercel response buffering so events flush immediately.
      'X-Accel-Buffering': 'no',
    },
  })
}
