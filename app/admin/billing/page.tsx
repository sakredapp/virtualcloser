import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import { listClients } from '@/lib/admin-db'
import {
  ADDON_CATALOG,
  formatPriceCents,
  formatCap,
  type AddonKey,
} from '@/lib/addons'

export const dynamic = 'force-dynamic'

type ClientAddonRow = {
  id: string
  rep_id: string
  addon_key: string
  status: 'active' | 'paused' | 'over_cap' | 'cancelled'
  monthly_price_cents: number
  cap_value: number | null
  cap_unit: string
}

type UsageEventAgg = {
  rep_id: string
  addon_key: string
  used: number
  cost_cents: number
}

function periodForNow(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

async function loadBilling() {
  const period = periodForNow()
  const [clients, addonsRes, eventsRes] = await Promise.all([
    listClients(),
    supabase
      .from('client_addons')
      .select('id,rep_id,addon_key,status,monthly_price_cents,cap_value,cap_unit')
      .in('status', ['active', 'over_cap', 'paused']),
    supabase
      .from('usage_events')
      .select('rep_id,addon_key,quantity,cost_cents_estimate,event_type')
      .eq('period_year_month', period)
      .neq('event_type', 'cap_hit_email_sent'),
  ])

  const addons = (addonsRes.data ?? []) as ClientAddonRow[]
  const events = eventsRes.data ?? []

  // Aggregate usage in-memory.
  const usageMap = new Map<string, UsageEventAgg>()
  for (const e of events) {
    const key = `${e.rep_id}::${e.addon_key}`
    const cur = usageMap.get(key) ?? {
      rep_id: e.rep_id,
      addon_key: e.addon_key,
      used: 0,
      cost_cents: 0,
    }
    cur.used += Number(e.quantity ?? 0)
    cur.cost_cents += Number(e.cost_cents_estimate ?? 0)
    usageMap.set(key, cur)
  }

  return { clients, addons, usageMap, period }
}

export default async function AdminBillingPage() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const { clients, addons, usageMap, period } = await loadBilling()

  // Group addons by client.
  const addonsByClient = new Map<string, ClientAddonRow[]>()
  for (const a of addons) {
    const arr = addonsByClient.get(a.rep_id) ?? []
    arr.push(a)
    addonsByClient.set(a.rep_id, arr)
  }

  // Compute global rollup.
  let totalMRR = 0
  let totalCost = 0
  for (const a of addons) {
    if (a.status === 'cancelled' || a.status === 'paused') continue
    totalMRR += a.monthly_price_cents
    const u = usageMap.get(`${a.rep_id}::${a.addon_key}`)
    if (u) totalCost += u.cost_cents
  }
  const totalMargin = totalMRR - totalCost
  const blendedMargin = totalMRR > 0 ? Math.round((totalMargin / totalMRR) * 100) : 0

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Billing</p>
        <h1 style={{ margin: '0 0 0.3rem' }}>Billing & usage</h1>
        <p className="sub" style={{ margin: 0 }}>
          Live rollup for period <strong>{period}</strong>. MRR, infra cost, margin per client.
        </p>
        <p className="nav" style={{ marginTop: '0.5rem' }}>
          <Link href="/admin/clients">← Clients</Link>
          <span>·</span>
          <Link href="/admin/prospects">Prospects</Link>
        </p>
      </header>

      {/* Global rollup */}
      <section
        className="card"
        style={{ marginBottom: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem' }}
      >
        <Stat label="Active MRR" value={formatPriceCents(totalMRR)} />
        <Stat label="Period infra cost" value={formatPriceCents(totalCost)} />
        <Stat
          label="Period margin"
          value={formatPriceCents(totalMargin)}
          tone={blendedMargin >= 30 ? 'good' : 'bad'}
        />
        <Stat
          label="Blended margin"
          value={`${blendedMargin}%`}
          tone={blendedMargin >= 30 ? 'good' : 'bad'}
        />
        <Stat label="Active clients" value={String(addonsByClient.size)} />
      </section>

      {/* Per-client rows */}
      {clients.length === 0 && (
        <section className="card">
          <p className="meta" style={{ margin: 0 }}>No clients yet.</p>
        </section>
      )}

      {clients.map((c) => {
        const cAddons = addonsByClient.get(c.id) ?? []
        if (cAddons.length === 0) return null

        let cMRR = 0
        let cCost = 0
        for (const a of cAddons) {
          if (a.status === 'cancelled' || a.status === 'paused') continue
          cMRR += a.monthly_price_cents
          const u = usageMap.get(`${c.id}::${a.addon_key}`)
          if (u) cCost += u.cost_cents
        }
        const cMargin = cMRR - cCost
        const cMarginPct = cMRR > 0 ? Math.round((cMargin / cMRR) * 100) : 0
        const overCapCount = cAddons.filter((a) => a.status === 'over_cap').length

        return (
          <section key={c.id} className="card" style={{ marginBottom: '0.75rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: '0.6rem',
                flexWrap: 'wrap',
                marginBottom: '0.6rem',
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>
                  <Link href={`/admin/clients/${c.id}`} style={{ color: 'var(--ink)' }}>
                    {c.display_name}
                  </Link>
                </h2>
                <p className="meta" style={{ margin: 0, fontSize: '12px' }}>
                  {c.id} · {cAddons.length} add-on{cAddons.length === 1 ? '' : 's'}
                  {overCapCount > 0 && (
                    <span style={{ color: 'var(--red)', marginLeft: 6, fontWeight: 700 }}>
                      · {overCapCount} OVER CAP
                    </span>
                  )}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', textAlign: 'right' }}>
                <MiniStat label="MRR" value={formatPriceCents(cMRR)} />
                <MiniStat label="Cost" value={formatPriceCents(cCost)} />
                <MiniStat
                  label="Margin"
                  value={`${cMarginPct}%`}
                  tone={cMarginPct >= 30 ? 'good' : 'bad'}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {cAddons.map((a) => {
                const def = ADDON_CATALOG[a.addon_key as AddonKey]
                const u = usageMap.get(`${c.id}::${a.addon_key}`)
                const used = u?.used ?? 0
                const cap = a.cap_value
                const pct = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
                const cost = u?.cost_cents ?? 0
                const margin = a.monthly_price_cents - cost
                const marginPct = a.monthly_price_cents > 0
                  ? Math.round((margin / a.monthly_price_cents) * 100)
                  : 0

                const anomalies: string[] = []
                if (a.status === 'over_cap') anomalies.push('OVER CAP')
                if (cost > a.monthly_price_cents) anomalies.push('LOSS')
                if (cap && used > cap * 0.9 && a.status === 'active') anomalies.push('NEAR CAP')

                return (
                  <div
                    key={a.id}
                    style={{
                      border: '1px solid ' + (anomalies.length ? 'var(--red)' : 'var(--ink-soft)'),
                      borderRadius: 8,
                      padding: '0.5rem 0.75rem',
                      background: anomalies.length ? '#fff5f3' : 'var(--paper)',
                      display: 'grid',
                      gridTemplateColumns: 'minmax(180px, 1.4fr) minmax(140px, 1fr) minmax(100px, auto) minmax(100px, auto) minmax(80px, auto)',
                      gap: '0.6rem',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: '13px' }}>
                        {def?.label ?? a.addon_key}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        {a.status}
                        {anomalies.map((x) => (
                          <span key={x} style={{ color: 'var(--red)', fontWeight: 700, marginLeft: 6 }}>
                            · {x}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      {cap ? (
                        <>
                          <div
                            style={{
                              height: 6,
                              borderRadius: 3,
                              background: 'var(--paper-2)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: '100%',
                                background: pct >= 90 ? 'var(--red)' : pct >= 70 ? '#d97706' : '#10b981',
                              }}
                            />
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: 2 }}>
                            {Math.round(used)} / {cap} {a.cap_unit}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {def ? formatCap(def) : 'unlimited'} · {Math.round(used)} used
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--ink)' }}>
                      {formatPriceCents(a.monthly_price_cents)}
                      <div style={{ fontSize: '10px', color: 'var(--muted)' }}>MRR</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--ink)' }}>
                      {formatPriceCents(cost)}
                      <div style={{ fontSize: '10px', color: 'var(--muted)' }}>cost</div>
                    </div>
                    <div
                      style={{
                        textAlign: 'right',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: marginPct >= 30 ? '#065f46' : 'var(--red)',
                      }}
                    >
                      {marginPct}%
                      <div style={{ fontSize: '10px', color: 'var(--muted)', fontWeight: 400 }}>margin</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      <section className="card" style={{ marginTop: '0.75rem' }}>
        <p className="meta" style={{ margin: 0, fontSize: '12px' }}>
          MRR is from <code>client_addons</code> (active or over_cap). Cost is{' '}
          <code>usage_events.cost_cents_estimate</code> for the open period. Cap-hit events are
          excluded. Closed prior periods live in <code>billing_periods</code>.
        </p>
      </section>
    </main>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
}) {
  const color = tone === 'good' ? '#065f46' : tone === 'bad' ? 'var(--red)' : 'var(--ink)'
  return (
    <div style={{ background: 'var(--paper-2)', borderRadius: 8, padding: '0.6rem 0.85rem' }}>
      <p
        style={{
          margin: 0,
          fontSize: '10px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--muted)',
        }}
      >
        {label}
      </p>
      <p style={{ margin: '0.2rem 0 0', fontSize: '1.15rem', fontWeight: 700, color }}>{value}</p>
    </div>
  )
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
}) {
  const color = tone === 'good' ? '#065f46' : tone === 'bad' ? 'var(--red)' : 'var(--ink)'
  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
