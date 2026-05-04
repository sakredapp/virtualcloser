'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { ClientIntegration, IntegrationKind } from '@/lib/client-integrations'

// ── Integration templates (quick-add) ────────────────────────────────────

type Template = {
  key: string
  label: string
  kind: IntegrationKind
  tier: 'all' | 'enterprise'
  fields: FieldDef[]
  helpText?: string
}

type FieldDef = {
  name: string
  label: string
  placeholder?: string
  required?: boolean
  type?: 'text' | 'password' | 'url' | 'textarea' | 'json'
}

const TEMPLATES: Template[] = [
  {
    key: 'bluebubbles', label: 'iMessage (BlueBubbles)', kind: 'api', tier: 'all',
    fields: [
      { name: 'url',      label: 'Server URL',  placeholder: 'https://xyz.ngrok.io', required: true, type: 'url' },
      { name: 'password', label: 'Password',    placeholder: 'BB server password',   required: true, type: 'password' },
    ],
    helpText: 'Client installs BlueBubbles on their Mac + enables cloud relay. Copy the relay URL + password here.',
  },
  {
    key: 'ghl', label: 'GoHighLevel CRM', kind: 'api', tier: 'all',
    fields: [
      { name: 'api_key',     label: 'API Key',      placeholder: 'Bearer token from GHL settings', required: true, type: 'password' },
      { name: 'location_id', label: 'Location ID',  placeholder: 'GHL location/account ID',       required: true },
    ],
    helpText: 'Settings → Integrations → API Keys in GHL. Use the Location API Key, not Company.',
  },
  {
    key: 'hubspot', label: 'HubSpot CRM', kind: 'api', tier: 'all',
    fields: [
      { name: 'api_key',    label: 'Private App Token', placeholder: 'pat-na1-...', required: true, type: 'password' },
      { name: 'portal_id',  label: 'Portal ID (optional)', placeholder: '12345678' },
    ],
    helpText: 'Settings → Integrations → Private Apps → Create a private app.',
  },
  {
    key: 'pipedrive', label: 'Pipedrive', kind: 'api', tier: 'all',
    fields: [
      { name: 'api_key',    label: 'API Token',    placeholder: 'From Pipedrive → Personal preferences', required: true, type: 'password' },
      { name: 'company_domain', label: 'Company domain', placeholder: 'yourcompany.pipedrive.com' },
    ],
  },
  {
    key: 'salesforce', label: 'Salesforce', kind: 'api', tier: 'all',
    fields: [
      { name: 'client_id',     label: 'Connected App Client ID',     placeholder: '', required: true, type: 'password' },
      { name: 'client_secret', label: 'Connected App Client Secret', placeholder: '', required: true, type: 'password' },
      { name: 'instance_url',  label: 'Instance URL', placeholder: 'https://yourorg.my.salesforce.com', type: 'url' },
      { name: 'refresh_token', label: 'Refresh Token (OAuth)', type: 'password' },
    ],
    helpText: 'Setup → Apps → App Manager → Connected Apps.',
  },
  {
    key: 'zapier', label: 'Zapier', kind: 'zapier', tier: 'all',
    fields: [
      { name: 'webhook_url', label: 'Zapier Webhook URL', placeholder: 'https://hooks.zapier.com/hooks/catch/...', required: true, type: 'url' },
    ],
    helpText: 'Trigger: Webhooks by Zapier → Catch Hook. Copy the webhook URL here.',
  },
  {
    key: 'wavv', label: 'WAVV dialer KPI ingest', kind: 'webhook_inbound', tier: 'all',
    fields: [
      { name: 'webhook_secret', label: 'Webhook secret (optional — only needed for direct/Zapier delivery)', type: 'password' },
      { name: 'api_key',        label: 'WAVV API key (optional, B2B partners only)', type: 'password' },
      { name: 'account_id',     label: 'WAVV account ID (optional)' },
    ],
    helpText: 'Most WAVV users dial inside GoHighLevel — in that case there is NOTHING to configure here. As long as GHL above is connected and addon_wavv_kpi is active, every call WAVV places will land in voice_calls + dialer_kpis automatically via the GHL Call Status workflow webhook. Only fill in fields here if the client is sending dispositions directly or via Zapier — then set webhook_secret and point the source at /api/webhooks/wavv/<rep-id>.',
  },
  {
    key: 'fathom', label: 'Fathom / Fireflies', kind: 'api', tier: 'all',
    fields: [
      { name: 'api_key',    label: 'API Key',     placeholder: '', required: true, type: 'password' },
      { name: 'webhook_secret', label: 'Webhook Secret (optional)', type: 'password' },
    ],
  },
  {
    key: 'revring', label: 'AI Voice', kind: 'api', tier: 'all',
    fields: [
      { name: 'api_key', label: 'Voice Provider API Key', placeholder: 'From voice provider dashboard', required: true, type: 'password' },
      { name: 'from_number', label: 'From Number (E.164)', placeholder: '+12025551234', required: true },
      { name: 'caller_id_name', label: 'Caller ID Name (max 15 chars)', placeholder: 'Acme Support' },
      { name: 'skip_queue', label: 'Skip Queue (true/false)', placeholder: 'false' },
      { name: 'dry_run', label: 'Dry Run (true/false) — set false to go live', placeholder: 'true' },
      { name: 'live_enabled', label: 'Live Enabled (true/false) — must also be true', placeholder: 'false' },
      { name: 'confirm_agent_id', label: 'Confirm / Receptionist Agent ID' },
      { name: 'reschedule_agent_id', label: 'Reschedule Agent ID' },
      { name: 'appointment_setter_agent_id', label: 'Appointment Setter Agent ID' },
      { name: 'pipeline_agent_id', label: 'Pipeline Agent ID' },
      { name: 'live_transfer_agent_id', label: 'Live Transfer Agent ID' },
      { name: 'webhook_secret', label: 'Webhook Secret (optional)', type: 'password' },
      { name: 'flow_definition', label: 'Flow Definition JSON (optional)', type: 'json' },
    ],
    helpText: 'AI Voice dialer config. Set dry_run=false AND live_enabled=true when the client is ready to go live. Both must be true or no real calls fire.',
  },
  {
    key: 'twilio', label: 'Twilio (BYO number)', kind: 'api', tier: 'all',
    fields: [
      { name: 'account_sid',  label: 'Account SID', placeholder: 'AC...', required: true, type: 'password' },
      { name: 'auth_token',   label: 'Auth Token',  placeholder: 'From Twilio Console', required: true, type: 'password' },
      { name: 'phone_number', label: 'Phone number (E.164)', placeholder: '+15551234567', required: true },
    ],
    helpText: 'Optional. If the client already uses a Twilio number, plug it in here so outbound calls show their existing caller-ID. Skip this and we use the RevRing-managed number from the RevRing config above.',
  },
  {
    key: 'custom_api', label: 'Custom API Integration', kind: 'api', tier: 'enterprise',
    fields: [
      { name: 'label',    label: 'Integration name', placeholder: 'e.g. Our Internal CRM', required: true },
      { name: 'base_url', label: 'Base URL',          placeholder: 'https://api.example.com', required: true, type: 'url' },
      { name: 'api_key',  label: 'API Key / Bearer token', type: 'password' },
      { name: 'api_secret', label: 'API Secret (if needed)', type: 'password' },
      { name: 'account_id', label: 'Account / Location ID' },
    ],
    helpText: 'For fully custom API builds. The key will be auto-slugged from the integration name.',
  },
  {
    key: 'custom_webhook', label: 'Custom Webhook', kind: 'webhook_outbound', tier: 'enterprise',
    fields: [
      { name: 'label',        label: 'Webhook name',        placeholder: 'e.g. Deal Closed → Slack', required: true },
      { name: 'endpoint_url', label: 'Endpoint URL',        placeholder: 'https://your-service.com/webhook', required: true, type: 'url' },
      { name: 'secret',       label: 'Signing secret (optional)', type: 'password' },
      { name: 'event_types',  label: 'Event types (comma-separated)', placeholder: 'deal.closed, lead.created' },
    ],
    helpText: 'VC will POST JSON to this URL for the specified events. Store the signing secret to verify requests.',
  },
]

const TIER_BADGE: Record<string, string> = {
  all:        '',
  enterprise: 'Enterprise only',
}

// ── Main component ────────────────────────────────────────────────────────

type Props = {
  repId: string
  tier: 'individual' | 'enterprise'
  initial: ClientIntegration[]
}

export default function ClientIntegrationsManager({ repId, tier, initial }: Props) {
  const router = useRouter()
  const [integrations, setIntegrations] = useState<ClientIntegration[]>(initial)
  const [adding, setAdding] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [formVals, setFormVals] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const tierOrder = { individual: 0, enterprise: 1 }
  const myTierRank = tierOrder[tier]

  const startAdd = useCallback((tpl: Template) => {
    setSelectedTemplate(tpl)
    setFormVals({})
    setError(null)
    setAdding(true)
    setEditingId(null)
  }, [])

  const startEdit = useCallback((integration: ClientIntegration) => {
    const tpl = TEMPLATES.find((t) => t.key === integration.key) ?? {
      key: integration.key,
      label: integration.label,
      kind: integration.kind,
      tier: 'all' as const,
      fields: Object.keys(integration.config).map((k) => ({ name: k, label: k })),
    }
    setSelectedTemplate(tpl)
    // Pre-fill form with existing config (obfuscate password fields)
    const prefilled: Record<string, string> = {}
    for (const f of tpl.fields) {
      const val = integration.config[f.name]
      if (val !== undefined && val !== null) {
        prefilled[f.name] = String(val)
      }
    }
    setFormVals(prefilled)
    setError(null)
    setAdding(true)
    setEditingId(integration.id)
  }, [])

  const handleSave = useCallback(async () => {
    if (!selectedTemplate) return
    setSaving(true)
    setError(null)

    try {
      // Build config from form values
      const config: Record<string, unknown> = {}
      for (const f of selectedTemplate.fields) {
        if (f.name === 'label') continue // label is stored top-level
        const v = formVals[f.name]?.trim()
        if (!v) continue

        if (f.type === 'json') {
          try {
            config[f.name] = JSON.parse(v)
          } catch {
            throw new Error(`${f.label} must be valid JSON`)
          }
          continue
        }

        if (v === 'true') {
          config[f.name] = true
        } else if (v === 'false') {
          config[f.name] = false
        } else {
          config[f.name] = v
        }
      }

      const labelVal = (formVals['label'] ?? selectedTemplate.label).trim()
      // For custom templates, slug the label into a key
      const key =
        selectedTemplate.key === 'custom_api' || selectedTemplate.key === 'custom_webhook'
          ? labelVal.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_+|_+$)/g, '') || selectedTemplate.key
          : selectedTemplate.key

      const res = await fetch('/api/admin/client-integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repId, key, label: labelVal, kind: selectedTemplate.kind, config }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const updated: ClientIntegration = await res.json()
      setIntegrations((prev) => {
        const idx = prev.findIndex((i) => i.id === updated.id || i.key === updated.key)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = updated
          return next
        }
        return [...prev, updated]
      })
      setAdding(false)
      setSelectedTemplate(null)
      setEditingId(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [selectedTemplate, formVals, repId, router])

  const handleToggle = useCallback(async (integration: ClientIntegration) => {
    const next = !integration.is_active
    setIntegrations((prev) => prev.map((i) => i.id === integration.id ? { ...i, is_active: next } : i))
    await fetch('/api/admin/client-integrations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: integration.id, is_active: next }),
    })
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Remove this integration? This deletes the stored credentials.')) return
    setIntegrations((prev) => prev.filter((i) => i.id !== id))
    await fetch('/api/admin/client-integrations', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  }, [])

  return (
    <div>
      {/* Existing integrations */}
      {integrations.length > 0 && (
        <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }}>
          {integrations.map((int) => (
            <div
              key={int.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.7rem 0.85rem',
                border: `1.5px solid ${int.is_active ? 'var(--red)' : 'var(--ink-soft)'}`,
                borderRadius: '8px',
                background: int.is_active ? 'rgba(255,40,0,0.04)' : 'var(--paper-2)',
                opacity: int.is_active ? 1 : 0.65,
              }}
            >
              {/* Active toggle */}
              <button
                onClick={() => handleToggle(int)}
                title={int.is_active ? 'Disable' : 'Enable'}
                style={{
                  flexShrink: 0,
                  width: '16px',
                  height: '16px',
                  borderRadius: '4px',
                  border: `1.5px solid ${int.is_active ? 'var(--red)' : 'var(--ink-soft)'}`,
                  background: int.is_active ? 'var(--red)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                {int.is_active && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '13px', color: 'var(--ink)' }}>
                  {int.label}
                </p>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--muted)' }}>
                  {int.kind} · key: {int.key} · {Object.keys(int.config).length} credential(s) stored
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                {int.key === 'wavv' && (
                  <button
                    onClick={async () => {
                      const res = await fetch('/api/admin/wavv-smoke-test', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ repId }),
                      })
                      const body = await res.json().catch(() => ({}))
                      alert(
                        `Status ${body.status}\n${body.hint ?? ''}\n\n${JSON.stringify(body.response, null, 2)}`,
                      )
                      router.refresh()
                    }}
                    style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 6, border: '1px solid var(--red)', background: 'rgba(255,40,0,0.06)', cursor: 'pointer', color: 'var(--red)', fontWeight: 600 }}
                  >
                    Smoke-test
                  </button>
                )}
                <button
                  onClick={() => startEdit(int)}
                  style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border-soft)', background: 'var(--paper)', cursor: 'pointer', color: 'var(--ink)' }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(int.id)}
                  style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(220,38,38,.3)', background: 'transparent', cursor: 'pointer', color: '#dc2626' }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add integration drawer */}
      {adding && selectedTemplate ? (
        <div style={{
          padding: '1rem',
          border: '1.5px solid var(--red)',
          borderRadius: '10px',
          background: 'rgba(255,40,0,0.04)',
          marginBottom: '1rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '14px', color: 'var(--ink)' }}>
              {editingId ? 'Edit' : 'Add'}: {selectedTemplate.label}
            </p>
            <button
              onClick={() => { setAdding(false); setSelectedTemplate(null); setEditingId(null) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--muted)', padding: 0 }}
            >
              ×
            </button>
          </div>

          {selectedTemplate.helpText && (
            <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
              {selectedTemplate.helpText}
            </p>
          )}

          <div style={{ display: 'grid', gap: '0.55rem' }}>
            {selectedTemplate.fields.map((f) => (
              <label key={f.name} style={{ display: 'grid', gap: '0.2rem', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)' }}>
                <span>{f.label}{f.required ? ' *' : ''}</span>
                {f.type === 'textarea' || f.type === 'json' ? (
                  <textarea
                    rows={f.type === 'json' ? 8 : 3}
                    value={formVals[f.name] ?? ''}
                    onChange={(e) => setFormVals((v) => ({ ...v, [f.name]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={inputSt}
                  />
                ) : (
                  <input
                    type={f.type ?? 'text'}
                    value={formVals[f.name] ?? ''}
                    onChange={(e) => setFormVals((v) => ({ ...v, [f.name]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={inputSt}
                    autoComplete="off"
                  />
                )}
              </label>
            ))}
          </div>

          {error && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '12px', color: '#dc2626' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ padding: '0.5rem 1rem', borderRadius: 8, background: 'var(--red)', color: '#fff', border: 'none', cursor: saving ? 'wait' : 'pointer', fontWeight: 700, fontSize: '13px' }}
            >
              {saving ? 'Saving…' : editingId ? 'Update' : 'Save integration'}
            </button>
            <button
              onClick={() => { setAdding(false); setSelectedTemplate(null); setEditingId(null) }}
              style={{ padding: '0.5rem 1rem', borderRadius: 8, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--border-soft)', cursor: 'pointer', fontSize: '13px' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '0.6rem' }}>
            Add integration:
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {TEMPLATES.map((tpl) => {
              const tierRank = { all: 0, enterprise: 1 }[tpl.tier]
              const allowed = tierRank <= myTierRank
              const badge = TIER_BADGE[tpl.tier]
              return (
                <button
                  key={tpl.key}
                  onClick={() => startAdd(tpl)}
                  disabled={!allowed}
                  title={!allowed ? `Requires ${TIER_BADGE[tpl.tier]} tier` : undefined}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: 7,
                    border: `1px solid ${allowed ? 'var(--ink-soft)' : 'rgba(0,0,0,0.1)'}`,
                    background: allowed ? 'var(--paper)' : 'var(--paper-2)',
                    cursor: allowed ? 'pointer' : 'not-allowed',
                    fontSize: '12px',
                    color: allowed ? 'var(--ink)' : 'var(--muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    fontFamily: 'inherit',
                    opacity: allowed ? 1 : 0.55,
                  }}
                >
                  + {tpl.label}
                  {badge && (
                    <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const inputSt: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderRadius: 8,
  border: '1px solid var(--border-soft)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontFamily: 'inherit',
  fontSize: '13px',
  textTransform: 'none',
  letterSpacing: 'normal',
  width: '100%',
  boxSizing: 'border-box',
}
