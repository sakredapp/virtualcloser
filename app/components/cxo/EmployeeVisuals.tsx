/**
 * Employees visuals: rings, attainment bars, bonus tier tracks, PTO bars and
 * month strips. Black/silver --cx-* tokens only (never red). Shared by the
 * exec Employees page and the employee self-view (/dashboard/me).
 */
import { fmtKpiValue, moreWords, periodLabel, SNAPSHOT_STATUS_WORDS, type EmployeeSnapshot, type QuotaLine, type TimeOff, type TimeOffKind } from '@/lib/employees/shared'
import './cxo-employees.css'

export const usd = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)
export const pctOf = (a: number | null | undefined) => (a == null ? '—' : `${Math.round(a * 100)}%`)

/** A progress ring. value 1 = 100%; over 100% shows a full ring and the real %. */
export function Ring({ value, size = 64, stroke = 7, label, sub }: { value: number | null; size?: number; stroke?: number; label?: string; sub?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = value == null ? 0 : Math.max(0, Math.min(1, value))
  return (
    <span className="cxe-ring" style={{ width: size, height: size }} role="img" aria-label={label ?? (value == null ? 'No data yet' : `${pctOf(value)} of quota`)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="trk" strokeWidth={stroke} />
        {value != null && v > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="val" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )}
      </svg>
      <span className="txt" style={{ fontSize: Math.max(11, Math.round(size / 4.4)) }}>
        {value == null ? '—' : pctOf(value)}
        {sub && <small>{sub}</small>}
      </span>
    </span>
  )
}

/** Attainment bar with an optional dashed projection to period end. */
export function AttainBar({ att, projected, wide }: { att: number | null; projected?: number | null; wide?: boolean }) {
  const w = Math.max(0, Math.min(100, (att ?? 0) * 100))
  const p = projected != null && projected > (att ?? 0) ? Math.max(0, Math.min(100, projected * 100)) : 0
  return (
    <span className={`cxe-bar${wide ? ' is-wide' : ''}`} aria-hidden>
      {p > 0 && <span className="proj" style={{ width: `${p}%` }} />}
      <span className="fill" style={{ width: `${w}%` }} />
      <i className="goal" />
    </span>
  )
}

/** Bonus earned vs possible as one bar. */
export function BonusBar({ earned, possible }: { earned: number; possible: number }) {
  if (possible <= 0) return <span className="cxe-muted">No bonus plan</span>
  const w = Math.max(0, Math.min(100, (earned / possible) * 100))
  return (
    <span className="cxe-bonus">
      <span className="cxe-bar is-bonus" aria-hidden>
        <span className="fill" style={{ width: `${w}%` }} />
      </span>
      <span className="nums">
        <b>{usd(earned)}</b> of {usd(possible)}
      </span>
    </span>
  )
}

export function StatusPill({ status }: { status: EmployeeSnapshot['status'] }) {
  return <span className={`cxe-pill is-${status}`}>{SNAPSHOT_STATUS_WORDS[status]}</span>
}

const PACE_WORDS: Record<QuotaLine['pace'], string> = { met: 'Hit', on_pace: 'On pace', behind: 'Behind', no_data: 'No numbers yet' }

/**
 * Tier track: the quota bar with a tick at each bonus tier (80/100/120%),
 * filled to where they are, plus "X more to reach tier N".
 */
export function TierTrack({ line, showBonus = true }: { line: QuotaLine; showBonus?: boolean }) {
  const tiers = line.tiers
  const maxPct = Math.max(120, ...tiers.map((t) => t.attain_pct + 10), Math.min(200, (line.att ?? 0) * 100 + 5))
  const at = (pct: number) => `${Math.max(0, Math.min(100, (pct / maxPct) * 100))}%`
  const attPct = (line.att ?? 0) * 100
  const projPct = line.projectedAtt != null && line.projectedAtt > (line.att ?? 0) ? line.projectedAtt * 100 : 0
  const idx = line.next ? tiers.findIndex((t) => t === line.next) : -1
  const more = moreWords(line)
  return (
    <div className="cxe-tiers">
      <div className="rail">
        {projPct > 0 && <span className="proj" style={{ width: at(projPct) }} />}
        <span className="fill" style={{ width: at(attPct) }} />
        <i className="goal" style={{ left: at(100) }} title="100% of quota" />
        {showBonus &&
          tiers.map((t, i) => (
            <span key={`${t.attain_pct}-${i}`} className={`tick${attPct + 1e-9 >= t.attain_pct ? ' is-hit' : ''}`} style={{ left: at(t.attain_pct) }}>
              <em>{t.attain_pct}%</em>
              <b>{usd(t.bonus)}</b>
            </span>
          ))}
      </div>
      {showBonus && tiers.length > 0 && (
        <p className="say">
          {line.tier ? `Tier ${tiers.indexOf(line.tier) + 1} earned: ${usd(line.tier.bonus)}.` : 'No tier reached yet.'}{' '}
          {line.next && more ? `${more} to reach tier ${idx + 1} (${usd(line.next.bonus)}).` : line.next ? '' : tiers.length ? 'Top tier reached.' : ''}
        </p>
      )}
    </div>
  )
}

/** One quota as a card: ring, actual of target, pace, tier track. */
export function QuotaCard({ line, showBonus, children }: { line: QuotaLine; showBonus: boolean; children?: React.ReactNode }) {
  const k = line.kpi
  return (
    <article className="cxe-quota">
      <div className="top">
        <Ring value={line.att} size={58} stroke={6} />
        <div className="what">
          <h4>{k.name}</h4>
          <p className="nums">
            <b>{fmtKpiValue(k.unit, line.actual)}</b> of {fmtKpiValue(k.unit, k.target)}
          </p>
          <p className="sub">
            {periodLabel(line.periodKey)}
            {k.actual_source === 'book' ? ' · from the book' : ''} · <span className={`pace is-${line.pace}`}>{PACE_WORDS[line.pace]}</span>
            {line.pace !== 'met' && line.projectedAtt != null && line.elapsed > 0 && line.elapsed < 1 ? ` · ${pctOf(line.projectedAtt)} at this pace` : ''}
          </p>
        </div>
        {children}
      </div>
      <TierTrack line={line} showBonus={showBonus} />
    </article>
  )
}

const KIND_WORDS: Record<TimeOffKind, string> = { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', other: 'Other' }

/** Days used by kind against days allowed. */
export function PtoBar({ used, byKind, allowed, left }: { used: number; byKind: Record<TimeOffKind, number>; allowed: number | null; left: number | null }) {
  const scale = Math.max(allowed ?? 0, used, 1)
  const kinds = (Object.keys(byKind) as TimeOffKind[]).filter((k) => byKind[k] > 0)
  return (
    <div className="cxe-pto">
      <div className="cxe-bar is-pto" role="img" aria-label={`${used} days used${allowed != null ? ` of ${allowed}` : ''}`}>
        {kinds.map((k) => (
          <span key={k} className={`seg k-${k}`} style={{ width: `${(byKind[k] / scale) * 100}%` }} />
        ))}
      </div>
      <p className="legend">
        <b>{fmtDays(used)}</b> used{allowed != null ? ` of ${fmtDays(allowed)}` : ''}
        {left != null ? ` · ${fmtDays(left)} left` : ''}
        {kinds.map((k) => (
          <span key={k} className="chip">
            <i className={`k-${k}`} />
            {KIND_WORDS[k]} {fmtDays(byKind[k])}
          </span>
        ))}
      </p>
    </div>
  )
}
const fmtDays = (n: number) => `${Number(n.toFixed(1))} ${Math.abs(n) === 1 ? 'day' : 'days'}`

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

/** A year as 12 small columns: days off per month (by start date). */
export function TimeOffStrip({ entries, year, today }: { entries: TimeOff[]; year: string; today: string }) {
  const per = new Array(12).fill(0) as number[]
  for (const e of entries) if (e.start_date.startsWith(year)) per[Number(e.start_date.slice(5, 7)) - 1] += Number(e.days) || 0
  const max = Math.max(1, ...per)
  const nowM = today.startsWith(year) ? Number(today.slice(5, 7)) - 1 : -1
  return (
    <div className="cxe-strip" role="img" aria-label={`Days off by month in ${year}`}>
      {per.map((d, i) => (
        <span key={i} className={`m${i === nowM ? ' is-now' : ''}`} title={`${d} days`}>
          <span className="col">
            <span style={{ height: `${(d / max) * 100}%` }} />
          </span>
          <em>{MONTHS[i]}</em>
        </span>
      ))}
    </div>
  )
}

/** Small month columns (QuickBooks hours). */
export function MiniColumns({ items, format }: { items: Array<{ label: string; value: number }>; format: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="cxe-strip is-cols" role="img" aria-label={items.map((i) => `${i.label} ${format(i.value)}`).join(', ')}>
      {items.map((it, i) => (
        <span key={it.label} className={`m${i === items.length - 1 ? ' is-now' : ''}`} title={format(it.value)}>
          <span className="col">
            <span style={{ height: `${(it.value / max) * 100}%` }} />
          </span>
          <em>{it.label}</em>
        </span>
      ))}
    </div>
  )
}
