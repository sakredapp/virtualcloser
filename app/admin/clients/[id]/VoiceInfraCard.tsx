'use client'

import { useState, useTransition } from 'react'

type Props = {
  repId: string
  clientSlug: string
  clientTier: string
  twilioConfig: Record<string, unknown> | null
  revringConfig: Record<string, unknown> | null
}

type VoiceBillingModel = 'shared' | 'own_trunk' | 'platform_trunk'

const MODEL_LABELS: Record<VoiceBillingModel, string> = {
  shared: 'Shared (individual — platform account)',
  own_trunk: 'Own trunk (enterprise brings their own RevRing account)',
  platform_trunk: 'Platform trunk (enterprise — we provision a dedicated trunk)',
}

export default function VoiceInfraCard({
  repId,
  clientTier,
  twilioConfig,
  revringConfig,
}: Props) {
  // ── Twilio state ──────────────────────────────────────────────────────────
  const twilioProvisioned = twilioConfig?.provisioned_by_platform === true
  const twilioSid = twilioConfig?.account_sid as string | undefined
  const twilioNumber = twilioConfig?.phone_number as string | undefined

  const [twilioPending, startTwilio] = useTransition()
  const [twilioResult, setTwilioResult] = useState<{ sid?: string; number?: string; error?: string } | null>(null)
  const [areaCode, setAreaCode] = useState('')

  function provisionTwilio() {
    startTwilio(async () => {
      setTwilioResult(null)
      try {
        const res = await fetch(`/api/admin/billing/${repId}/provision-twilio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ area_code: areaCode.trim() || undefined }),
        })
        const data = (await res.json()) as { ok?: boolean; account_sid?: string; phone_number?: string; error?: string; already_provisioned?: boolean }
        if (!res.ok || !data.ok) {
          setTwilioResult({ error: data.error ?? `HTTP ${res.status}` })
        } else {
          setTwilioResult({
            sid: data.account_sid,
            number: data.phone_number ?? undefined,
          })
        }
      } catch (err) {
        setTwilioResult({ error: err instanceof Error ? err.message : 'unknown error' })
      }
    })
  }

  // ── RevRing state ─────────────────────────────────────────────────────────
  const currentModel = ((revringConfig?.voice_billing_model as string) || 'shared') as VoiceBillingModel
  const currentTrunkSid = revringConfig?.trunk_sid as string | undefined
  const kbId = revringConfig?.knowledge_base_id as string | undefined
  const kbSyncedAt = revringConfig?.kb_synced_at as string | undefined
  const kbDocCount = revringConfig?.kb_doc_count as number | undefined

  const [rrModel, setRrModel] = useState<VoiceBillingModel>(currentModel)
  const [rrApiKey, setRrApiKey] = useState('')
  const [rrTrunkSid, setRrTrunkSid] = useState(currentTrunkSid ?? '')
  const [rrFromNumber, setRrFromNumber] = useState('')
  const [rrPending, startRR] = useTransition()
  const [rrResult, setRrResult] = useState<{ trunk_sid?: string; error?: string } | null>(null)

  // ── KB sync state ─────────────────────────────────────────────────────────
  const [kbPending, startKB] = useTransition()
  const [kbResult, setKbResult] = useState<{
    ok?: boolean; knowledge_base_id?: string; docs_uploaded?: number
    agents_linked?: string[]; skipped_no_content?: number; error?: string
  } | null>(null)

  function syncKB() {
    startKB(async () => {
      setKbResult(null)
      try {
        const res = await fetch(`/api/admin/billing/${repId}/sync-revring-kb`, { method: 'POST' })
        const data = await res.json() as typeof kbResult
        setKbResult(data)
      } catch (err) {
        setKbResult({ error: err instanceof Error ? err.message : 'unknown error' })
      }
    })
  }

  function saveRRModel() {
    startRR(async () => {
      setRrResult(null)
      try {
        const body: Record<string, unknown> = { model: rrModel }
        if (rrModel === 'own_trunk') {
          if (rrApiKey.trim()) body.api_key = rrApiKey.trim()
          if (rrTrunkSid.trim()) body.trunk_sid = rrTrunkSid.trim()
          if (rrFromNumber.trim()) body.from_number = rrFromNumber.trim()
        }
        if (rrModel === 'platform_trunk') {
          if (rrTrunkSid.trim()) body.trunk_sid = rrTrunkSid.trim()
          if (rrFromNumber.trim()) body.from_number = rrFromNumber.trim()
        }
        const res = await fetch(`/api/admin/billing/${repId}/provision-revring-trunk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = (await res.json()) as { ok?: boolean; trunk_sid?: string; error?: string }
        if (!res.ok || !data.ok) {
          setRrResult({ error: data.error ?? `HTTP ${res.status}` })
        } else {
          setRrResult({ trunk_sid: data.trunk_sid })
        }
      } catch (err) {
        setRrResult({ error: err instanceof Error ? err.message : 'unknown error' })
      }
    })
  }

  const badge = (label: string, color: string, bg: string) => (
    <span style={{
      display: 'inline-block',
      fontSize: 10,
      fontWeight: 800,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.08em',
      color,
      background: bg,
      padding: '2px 7px',
      borderRadius: 5,
    }}>
      {label}
    </span>
  )

  return (
    <section className="card" style={{ marginTop: '1rem', borderLeft: '4px solid #0b1f5c' }}>
      <div className="section-head">
        <h2>Voice &amp; SMS infrastructure</h2>
        <p>{clientTier} tier</p>
      </div>

      {/* ── Twilio sub-account ─────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <strong style={{ fontSize: 14 }}>Twilio sub-account</strong>
          {twilioProvisioned
            ? badge('provisioned', '#fff', '#1f8a3b')
            : twilioSid
              ? badge('manual creds', '#fff', '#b45309')
              : badge('not set up', '#fff', '#c21a00')}
        </div>
        <p style={{ fontSize: 12, color: '#374151', margin: '0 0 8px' }}>
          Twilio ToS requires each client to have their own sub-account so you can legally
          resell voice + SMS. Provisioning creates an isolated sub-account under the platform
          master account — billing rolls up to you, usage is per-client.
        </p>

        {twilioProvisioned ? (
          <div style={{ fontSize: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '8px 12px' }}>
            <p style={{ margin: 0 }}>
              Sub-account SID: <code style={{ fontSize: 11 }}>{twilioSid}</code>
            </p>
            {twilioNumber && (
              <p style={{ margin: '4px 0 0' }}>Phone number: <strong>{twilioNumber}</strong></p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
              <span style={{ color: '#374151', fontWeight: 600 }}>Area code (optional)</span>
              <input
                type="text"
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value)}
                placeholder="e.g. 305"
                maxLength={3}
                style={{ width: 80, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
              />
            </label>
            <button
              type="button"
              onClick={provisionTwilio}
              disabled={twilioPending}
              style={{
                background: twilioPending ? '#9ca3af' : '#0b1f5c',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '7px 16px',
                fontWeight: 700,
                fontSize: 13,
                cursor: twilioPending ? 'not-allowed' : 'pointer',
              }}
            >
              {twilioPending ? 'Provisioning…' : 'Provision Twilio sub-account'}
            </button>
          </div>
        )}

        {twilioResult?.error && (
          <p style={{ fontSize: 12, color: '#b91c1c', fontWeight: 700, margin: '6px 0 0', background: '#fef2f2', padding: '6px 10px', borderRadius: 5 }}>
            Error: {twilioResult.error}
          </p>
        )}
        {twilioResult?.sid && !twilioResult.error && (
          <p style={{ fontSize: 12, color: '#166534', fontWeight: 700, margin: '6px 0 0', background: '#f0fdf4', padding: '6px 10px', borderRadius: 5 }}>
            ✓ Sub-account created: {twilioResult.sid}
            {twilioResult.number ? ` · Number: ${twilioResult.number}` : ' · No number purchased (buy one in Twilio console under the sub-account)'}
            &nbsp;— refresh page to see updated status.
          </p>
        )}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '0 0 18px' }} />

      {/* ── RevRing voice billing model ────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <strong style={{ fontSize: 14 }}>AI Voice billing model</strong>
          {badge(
            currentModel === 'shared' ? 'shared' : currentModel === 'own_trunk' ? 'own trunk' : 'platform trunk',
            '#fff',
            currentModel === 'shared' ? '#374151' : '#0b1f5c',
          )}
          {currentTrunkSid && (
            <span style={{ fontSize: 11, color: '#4b5563' }}>
              trunk: <code style={{ fontSize: 10 }}>{currentTrunkSid.slice(0, 16)}…</code>
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: '#374151', margin: '0 0 10px' }}>
          <strong>Shared</strong> — individual clients use the platform&apos;s RevRing account (REVRING_API_KEY env var) with per-client agent IDs.&nbsp;
          <strong>Own trunk</strong> — enterprise client has their own RevRing account; store their credentials here.&nbsp;
          <strong>Platform trunk</strong> — enterprise gets a dedicated trunk provisioned under the platform&apos;s master account.
        </p>

        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
            <span style={{ color: '#374151', fontWeight: 600 }}>Billing model</span>
            <select
              value={rrModel}
              onChange={(e) => setRrModel(e.target.value as VoiceBillingModel)}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, maxWidth: 400 }}
            >
              {(Object.entries(MODEL_LABELS) as [VoiceBillingModel, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>

          {rrModel === 'own_trunk' && (
            <>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                <span style={{ color: '#374151', fontWeight: 600 }}>Client RevRing API key</span>
                <input
                  type="password"
                  value={rrApiKey}
                  onChange={(e) => setRrApiKey(e.target.value)}
                  placeholder="rr_live_… (leave blank to keep existing)"
                  style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, maxWidth: 400 }}
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                <span style={{ color: '#374151', fontWeight: 600 }}>Trunk SID</span>
                <input
                  type="text"
                  value={rrTrunkSid}
                  onChange={(e) => setRrTrunkSid(e.target.value)}
                  placeholder="trunk SID from client's RevRing account"
                  style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, maxWidth: 400 }}
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                <span style={{ color: '#374151', fontWeight: 600 }}>From number (E.164)</span>
                <input
                  type="text"
                  value={rrFromNumber}
                  onChange={(e) => setRrFromNumber(e.target.value)}
                  placeholder="+13055551234"
                  style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, maxWidth: 300 }}
                />
              </label>
            </>
          )}

          {rrModel === 'platform_trunk' && (
            <>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                <span style={{ color: '#374151', fontWeight: 600 }}>
                  Trunk SID{' '}
                  <span style={{ fontWeight: 400, color: '#6b7280' }}>
                    — paste existing SID, or leave blank to provision a new one via RevRing API
                  </span>
                </span>
                <input
                  type="text"
                  value={rrTrunkSid}
                  onChange={(e) => setRrTrunkSid(e.target.value)}
                  placeholder="leave blank to auto-provision"
                  style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, maxWidth: 400 }}
                />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                <span style={{ color: '#374151', fontWeight: 600 }}>From number (E.164)</span>
                <input
                  type="text"
                  value={rrFromNumber}
                  onChange={(e) => setRrFromNumber(e.target.value)}
                  placeholder="+13055551234"
                  style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, maxWidth: 300 }}
                />
              </label>
              {!rrTrunkSid && (
                <p style={{ fontSize: 11, color: '#92400e', background: '#fef3c7', padding: '6px 10px', borderRadius: 5, margin: 0 }}>
                  ⚠ Auto-provisioning calls <code>POST /v1/trunks</code> on the RevRing API. Confirm the exact endpoint
                  with your RevRing rep before using this — the trunk SID field is available as a safe fallback.
                </p>
              )}
            </>
          )}

          <button
            type="button"
            onClick={saveRRModel}
            disabled={rrPending}
            style={{
              background: rrPending ? '#9ca3af' : '#0b1f5c',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '7px 16px',
              fontWeight: 700,
              fontSize: 13,
              cursor: rrPending ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-start',
              marginTop: 2,
            }}
          >
            {rrPending ? 'Saving…' : rrModel === 'platform_trunk' && !rrTrunkSid ? 'Provision trunk' : 'Save voice model'}
          </button>
        </div>

        {rrResult?.error && (
          <p style={{ fontSize: 12, color: '#b91c1c', fontWeight: 700, margin: '8px 0 0', background: '#fef2f2', padding: '6px 10px', borderRadius: 5 }}>
            Error: {rrResult.error}
          </p>
        )}
        {rrResult && !rrResult.error && (
          <p style={{ fontSize: 12, color: '#166534', fontWeight: 700, margin: '8px 0 0', background: '#f0fdf4', padding: '6px 10px', borderRadius: 5 }}>
            ✓ Saved{rrResult.trunk_sid ? ` · trunk SID: ${rrResult.trunk_sid}` : ''} — refresh page to see updated status.
          </p>
        )}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '18px 0' }} />

      {/* ── Knowledge Base sync ────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <strong style={{ fontSize: 14 }}>Training docs → RevRing Knowledge Base</strong>
          {kbId
            ? badge('synced', '#fff', '#1f8a3b')
            : badge('not synced', '#fff', '#9ca3af')}
        </div>
        <p style={{ fontSize: 12, color: '#374151', margin: '0 0 8px' }}>
          Training docs uploaded by the client are pushed to a RevRing Knowledge Base and linked
          to all their configured agent IDs. RevRing RAG then searches the KB automatically on
          every call — no manual prompt editing needed. Sync runs automatically on every doc
          upload/change; use the button below to force a full re-sync (e.g. after adding new agent IDs).
        </p>

        {kbId && (
          <div style={{ fontSize: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
            <p style={{ margin: 0 }}>
              KB ID: <code style={{ fontSize: 11 }}>{kbId}</code>
            </p>
            {kbDocCount !== undefined && (
              <p style={{ margin: '3px 0 0' }}>{kbDocCount} doc{kbDocCount !== 1 ? 's' : ''} uploaded</p>
            )}
            {kbSyncedAt && (
              <p style={{ margin: '3px 0 0', color: '#4b5563' }}>
                Last synced: {new Date(kbSyncedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {!kbId && (
          <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', padding: '6px 10px', borderRadius: 5, margin: '0 0 8px' }}>
            No KB synced yet. Click below to create the KB, upload all active training docs,
            and link it to all configured agent IDs. Client training docs will auto-sync after this first run.
          </p>
        )}

        <button
          type="button"
          onClick={syncKB}
          disabled={kbPending}
          style={{
            background: kbPending ? '#9ca3af' : '#0b1f5c',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '7px 16px',
            fontWeight: 700,
            fontSize: 13,
            cursor: kbPending ? 'not-allowed' : 'pointer',
          }}
        >
          {kbPending ? 'Syncing…' : kbId ? 'Force re-sync KB' : 'Create KB + sync docs'}
        </button>

        {kbResult?.error && (
          <p style={{ fontSize: 12, color: '#b91c1c', fontWeight: 700, margin: '8px 0 0', background: '#fef2f2', padding: '6px 10px', borderRadius: 5 }}>
            Error: {kbResult.error}
          </p>
        )}
        {kbResult && !kbResult.error && (
          <p style={{ fontSize: 12, color: '#166534', fontWeight: 700, margin: '8px 0 0', background: '#f0fdf4', padding: '6px 10px', borderRadius: 5 }}>
            ✓ Synced {kbResult.docs_uploaded} doc{kbResult.docs_uploaded !== 1 ? 's' : ''} to KB{' '}
            <code style={{ fontSize: 10 }}>{kbResult.knowledge_base_id}</code>
            {' '}· linked to {kbResult.agents_linked?.length ?? 0} agent{(kbResult.agents_linked?.length ?? 0) !== 1 ? 's' : ''}
            {(kbResult.skipped_no_content ?? 0) > 0 && ` · ${kbResult.skipped_no_content} skipped (no extractable text)`}
            {' '}— refresh page to update status.
          </p>
        )}
      </div>
    </section>
  )
}
