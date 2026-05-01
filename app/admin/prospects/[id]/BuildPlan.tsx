'use client'

import { useState } from 'react'
import type { Prospect } from '@/lib/prospects'

type PlanResult = {
  summary: string
  plan: string
  integrations: string[]
  build_cost: number
  maintenance_cost: number
  cost_reasoning: string
  suggested_tier: string
  timeline_weeks: number
}

export default function BuildPlan({ prospect }: { prospect: Prospect }) {
  const [brief, setBrief] = useState(prospect.build_brief ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PlanResult | null>(null)

  // Populate from existing DB data on first render
  const [initialPlan] = useState(prospect.build_plan)
  const [initialSummary] = useState(prospect.build_summary)
  const [initialBuildCost] = useState(prospect.build_cost_estimate)
  const [initialMaintenanceCost] = useState(prospect.maintenance_estimate)
  const [initialGeneratedAt] = useState(prospect.plan_generated_at)

  const displayPlan = result?.plan ?? initialPlan
  const displaySummary = result?.summary ?? initialSummary
  const displayBuildCost = result?.build_cost ?? initialBuildCost
  const displayMaintenanceCost = result?.maintenance_cost ?? initialMaintenanceCost
  const displayGeneratedAt = result ? new Date().toISOString() : initialGeneratedAt

  async function generate() {
    if (brief.trim().length < 10) {
      setError('Write at least a sentence about what they want built.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/prospect-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId: prospect.id, buildBrief: brief }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong')
        return
      }
      setResult(json as PlanResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

      {/* Brief input */}
      <div>
        <label style={{ display: 'block', fontWeight: 700, fontSize: '13px', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
          Build Brief
        </label>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 0.5rem' }}>
          Describe in plain English what this client wants. Include their sales process, team size, tools they use, pain points, and any custom requirements.
        </p>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={6}
          placeholder="e.g. They have 8 reps using HubSpot, want each rep to get a morning brief via Telegram with their top 3 leads. Manager wants a weekly rollup. They use Fathom for call recording and want AI summaries attached to HubSpot deals automatically. Custom pricing page needed..."
          style={{
            width: '100%',
            padding: '0.75rem',
            border: '1px solid var(--border-soft)',
            borderRadius: '8px',
            fontSize: '13px',
            lineHeight: 1.55,
            resize: 'vertical',
            fontFamily: 'inherit',
            color: 'var(--ink)',
            background: 'var(--paper)',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            onClick={generate}
            disabled={loading}
            style={{
              padding: '9px 20px',
              background: loading ? 'var(--muted)' : 'var(--red)',
              color: '#fff',
              border: 'none',
              borderRadius: '999px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading ? 'Generating plan…' : displayPlan ? 'Regenerate Plan' : 'Generate Plan'}
          </button>
          {displayGeneratedAt && !loading && (
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
              Last generated {new Date(displayGeneratedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
        {error && (
          <p style={{ marginTop: '0.5rem', fontSize: '12px', color: 'var(--red)', fontWeight: 600 }}>{error}</p>
        )}
      </div>

      {/* Summary + cost cards */}
      {(displaySummary || displayBuildCost != null) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.75rem', alignItems: 'start' }}>
          {displaySummary && (
            <div style={{ background: 'var(--paper-2)', border: '1px solid var(--border-soft)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
              <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.55, color: 'var(--ink)' }}>{displaySummary}</p>
            </div>
          )}
          {displayBuildCost != null && (
            <div style={{ background: 'var(--paper)', border: '1px solid var(--ink)', borderRadius: '8px', padding: '0.85rem 1rem', textAlign: 'center', minWidth: '110px' }}>
              <p style={{ margin: '0 0 0.2rem', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>Build Cost</p>
              <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--ink)' }}>${displayBuildCost?.toLocaleString()}</p>
              <p style={{ margin: '0.15rem 0 0', fontSize: '10px', color: 'var(--muted)' }}>one-time</p>
            </div>
          )}
          {displayMaintenanceCost != null && (
            <div style={{ background: 'var(--paper)', border: '1px solid var(--ink)', borderRadius: '8px', padding: '0.85rem 1rem', textAlign: 'center', minWidth: '110px' }}>
              <p style={{ margin: '0 0 0.2rem', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>Monthly</p>
              <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--red)' }}>${displayMaintenanceCost?.toLocaleString()}</p>
              <p style={{ margin: '0.15rem 0 0', fontSize: '10px', color: 'var(--muted)' }}>/month</p>
            </div>
          )}
        </div>
      )}

      {/* Integrations */}
      {result?.integrations && result.integrations.length > 0 && (
        <div>
          <p style={{ margin: '0 0 0.4rem', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Integrations</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {result.integrations.map((i) => (
              <span key={i} style={{ padding: '3px 10px', background: 'rgba(255,40,0,0.08)', color: 'var(--red)', fontSize: '11px', fontWeight: 700, borderRadius: '999px', border: '1px solid rgba(255,40,0,0.2)' }}>{i}</span>
            ))}
          </div>
        </div>
      )}

      {/* Cost reasoning */}
      {result?.cost_reasoning && (
        <div style={{ background: 'var(--paper-2)', border: '1px solid var(--border-soft)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
          <p style={{ margin: '0 0 0.25rem', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Cost Breakdown</p>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink)', lineHeight: 1.5 }}>{result.cost_reasoning}</p>
        </div>
      )}

      {/* Full build plan */}
      {displayPlan && (
        <div>
          <p style={{ margin: '0 0 0.5rem', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Build Plan</p>
          <div style={{
            background: 'var(--paper)',
            border: '1px solid var(--border-soft)',
            borderRadius: '10px',
            padding: '1rem 1.1rem',
            fontSize: '13px',
            lineHeight: 1.65,
            color: 'var(--ink)',
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
          }}>
            {displayPlan}
          </div>
        </div>
      )}

      <style jsx global>{`
        @media (max-width: 640px) {
          .build-plan-costs { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
