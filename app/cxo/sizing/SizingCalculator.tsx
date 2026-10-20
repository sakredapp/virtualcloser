'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { defaultPeak, formatRange, sizePrivateServer, type Placement, type Workload } from '@/lib/cxoSizing'

/** File volume choices, in GB (the upper end of each band). */
const FILES = [
  { id: 'xs', label: 'Under 50 GB', gb: 50 },
  { id: 'sm', label: '50 to 500 GB', gb: 500 },
  { id: 'md', label: '500 GB to 2 TB', gb: 2_000 },
  { id: 'lg', label: '2 to 10 TB', gb: 10_000 },
] as const

const WORKLOADS: { id: Workload; label: string; hint: string }[] = [
  { id: 'short', label: 'Short questions', hint: 'Quick answers, drafts, recaps' },
  { id: 'mixed', label: 'A mix', hint: 'Some long files, mostly questions' },
  { id: 'long', label: 'Long documents', hint: 'Reports, contracts, big files' },
]

const PLACES: { id: Placement; label: string; hint: string }[] = [
  { id: 'office', label: 'In our office', hint: 'A box on your premises' },
  { id: 'rented', label: 'Rented, just for us', hint: 'No hardware to house' },
]

const num = (v: string) => {
  const n = Number(v.replace(/[^0-9]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export default function SizingCalculator({ bookHref }: { bookHref: string }) {
  const [staff, setStaff] = useState('40')
  const [peak, setPeak] = useState('')
  const [workload, setWorkload] = useState<Workload>('mixed')
  const [placement, setPlacement] = useState<Placement>('office')
  const [offline, setOffline] = useState(false)
  const [files, setFiles] = useState<(typeof FILES)[number]['id']>('sm')
  const [fineTune, setFineTune] = useState(false)

  const staffN = Math.max(1, num(staff) || 1)
  const peakN = peak.trim() ? Math.max(1, num(peak)) : null
  const r = useMemo(
    () =>
      sizePrivateServer({
        staff: staffN,
        peak: peakN,
        workload,
        offline,
        placement,
        fileGb: FILES.find((f) => f.id === files)?.gb ?? 500,
        fineTune,
      }),
    [staffN, peakN, workload, offline, placement, files, fineTune],
  )

  const p = r.monthlyParts
  const title = r.boxes > 1 ? `${r.boxes} × ${r.label}` : r.label

  return (
    <div className="cxs-calc">
      <form className="cxs-card cxs-calc-form" onSubmit={(e) => e.preventDefault()} aria-label="Your firm">
        <div className="cxs-calc-row is-2">
          <label className="cxs-field">
            <span className="cxs-field-k">People who will use it</span>
            <input inputMode="numeric" value={staff} onChange={(e) => setStaff(e.target.value)} aria-describedby="staff-hint" />
            <span className="cxs-field-hint" id="staff-hint">Everyone with a login.</span>
          </label>
          <label className="cxs-field">
            <span className="cxs-field-k">Busiest moment</span>
            <input
              inputMode="numeric"
              value={peak}
              placeholder={String(defaultPeak(staffN))}
              onChange={(e) => setPeak(e.target.value)}
              aria-describedby="peak-hint"
            />
            <span className="cxs-field-hint" id="peak-hint">People using it at once. Leave blank for our guess.</span>
          </label>
        </div>

        <fieldset className="cxs-field">
          <legend className="cxs-field-k">What they ask it for</legend>
          <div className="cxs-seg is-3">
            {WORKLOADS.map((w) => (
              <label key={w.id} className={workload === w.id ? 'is-on' : ''}>
                <input type="radio" name="workload" value={w.id} checked={workload === w.id} onChange={() => setWorkload(w.id)} />
                <b>{w.label}</b>
                <span>{w.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="cxs-field">
          <legend className="cxs-field-k">Where it runs</legend>
          <div className="cxs-seg is-2">
            {PLACES.map((pl) => (
              <label key={pl.id} className={placement === pl.id ? 'is-on' : ''}>
                <input type="radio" name="placement" value={pl.id} checked={placement === pl.id} onChange={() => setPlacement(pl.id)} />
                <b>{pl.label}</b>
                <span>{pl.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="cxs-field">
          <span className="cxs-field-k">Company files it should read</span>
          <select value={files} onChange={(e) => setFiles(e.target.value as (typeof FILES)[number]['id'])}>
            {FILES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <div className="cxs-checks">
          <label className="cxs-check">
            <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} />
            <span>
              <b>Must work with the internet off</b>
              <span>Or must never connect to the internet.</span>
            </span>
          </label>
          <label className="cxs-check">
            <input type="checkbox" checked={fineTune} onChange={(e) => setFineTune(e.target.checked)} />
            <span>
              <b>Train it on our own work</b>
              <span>Your report format, your tone, how you review a file.</span>
            </span>
          </label>
        </div>
      </form>

      <aside className="cxs-price-card cxs-calc-result" aria-live="polite" aria-label="Recommended size">
        <p className="cxs-card-k">You would need</p>
        <h2 className="cxs-h cxs-calc-title">{title}</h2>
        <p className="cxs-calc-sub">
          {r.size}, with the {r.model.toLowerCase().replace(' ai ', ' AI ')}. It can write{' '}
          {Math.floor(r.streamsCapacity)} answers at once; at your busiest ({r.peak} {r.peak === 1 ? 'person' : 'people'}) you
          need {r.streamsNeeded}.
        </p>
        {r.offlineForcedOffice && <p className="cxs-calc-flag">Working with the internet off means it has to be in your office.</p>}

        <dl className="cxs-calc-lines">
          <div className="is-big">
            <dt>{r.tier === 'rented' ? 'Setup, one time' : 'Hardware, one time'}</dt>
            <dd>{formatRange(r.hardware)}</dd>
          </div>
          <div className="is-big">
            <dt>Running cost, monthly</dt>
            <dd>{formatRange(r.monthly)}</dd>
          </div>
          {r.tier === 'rented' ? (
            <div>
              <dt>Server rent</dt>
              <dd>{formatRange(p.rent)}</dd>
            </div>
          ) : (
            <>
              <div>
                <dt>Power and cooling</dt>
                <dd>{formatRange(p.power)}</dd>
              </div>
              <div>
                <dt>Battery backup upkeep</dt>
                <dd>{formatRange(p.ups)}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Care plan: updates, monitoring, fixes</dt>
            <dd>{formatRange([p.care, p.care])}</dd>
          </div>
          <div>
            <dt>Our build and setup, one time</dt>
            <dd>{formatRange([r.buildFee, r.buildFee])}</dd>
          </div>
          {r.fineTuneRun && (
            <div>
              <dt>Training on your work, each run</dt>
              <dd>{formatRange(r.fineTuneRun)}</dd>
            </div>
          )}
          <div>
            <dt>Storage</dt>
            <dd>{r.storageTb} TB</dd>
          </div>
        </dl>

        <div className="cxs-actions">
          <Link className="cx-btn cxs-btn cxs-btn-lg" href={bookHref}>
            Book a call
          </Link>
        </div>
        <p className="cxs-note">
          Estimates from current hardware prices. The private server isn&rsquo;t available yet; we&rsquo;ll confirm the size and
          price on a call.
        </p>
      </aside>
    </div>
  )
}
