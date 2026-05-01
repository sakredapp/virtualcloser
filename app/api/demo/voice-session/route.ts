// POST /api/demo/voice-session
//
// Stub endpoint for the demo "Try the voice" button. Tomorrow's RevRing
// integration will wire this up to actually mint a WebRTC session
// (or Twilio SIP-trunked call) against a sandbox AI SDR.
//
// Response shape (when wired):
//   { ok: true, session: { provider: 'webrtc'|'twilio_sip', token: string,
//     ice_servers?: RTCIceServer[], sip_uri?: string, expires_in_sec: number } }
//
// Until then we return 501 with a friendly message + everything the
// client component needs to render a placeholder state.

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      reason: 'not_wired_yet',
      message:
        'Voice demo session minting is wired tomorrow alongside the RevRing + Twilio SIP setup. The button + UI shell on the demo pages exposes this contract so the dev can swap the stub for a real session payload without touching the client.',
      contract: {
        method: 'POST',
        path: '/api/demo/voice-session',
        request_body_schema: {
          mode: 'enum: appointment_setter | receptionist | live_transfer | workflows',
          tier: 'enum: individual | enterprise',
        },
        response_success: {
          ok: true,
          session: {
            provider: 'webrtc | twilio_sip',
            token: 'short-lived JWT or signed URL',
            ice_servers: 'RTCIceServer[] (webrtc only)',
            sip_uri: 'sip:demo@... (twilio only)',
            expires_in_sec: 'number — typically 60-120',
            sandbox_agent_id: 'RevRing agent id we routed the demo to',
          },
        },
      },
    },
    { status: 501 },
  )
}
