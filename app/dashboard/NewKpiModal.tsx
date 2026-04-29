'use client'

import { useState, useTransition } from 'react'

/**
 * Detailed "New KPI" modal launched from the Daily KPIs header. Lets the
 * rep configure: metric label, unit, tracking period, goal target +
 * deadline, starting progress, and a reminder cadence (so Telegram can
 * actually nag them on a schedule THEY pick).
 *
 * The submit handler is a server action passed in as `action`. We post
 * a FormData to it and close the dialog when the action resolves.
 */
export default function NewKpiModal({
  action,
}: {
  action: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [cadence, setCadence] = useState<'none' | 'daily' | 'weekdays' | 'weekly'>('none')

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await action(fd)
      setOpen(false)
      // Reset local state for next open.
      setCadence('none')
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn"
        style={{
          padding: '0.45rem 0.9rem',
          fontSize: '0.82rem',
          fontWeight: 700,
          background: 'var(--red, #ff2800)',
          color: '#fff',
          border: 0,
          borderRadius: 8,
          cursor: 'pointer',
          letterSpacing: '0.02em',
        }}
      >
        + New KPI
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-kpi-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(15, 15, 15, 0.55)',
            display: 'grid',
            placeItems: 'center',
            padding: '1rem',
            overflowY: 'auto',
          }}
        >
          <form
            onSubmit={onSubmit}
            style={{
              width: '100%',
              maxWidth: 560,
              background: 'var(--paper, #fff)',
              color: 'var(--ink, #0f0f0f)',
              borderRadius: 14,
              boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
              border: '1.5px solid var(--ink, #0f0f0f)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '1rem 1.2rem',
                borderBottom: '1px solid var(--line, #e6e1d8)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: '0.6rem',
              }}
            >
              <div>
                <h2 id="new-kpi-title" style={{ margin: 0, fontSize: '1.1rem' }}>
                  New KPI
                </h2>
                <p
                  style={{
                    margin: '0.15rem 0 0',
                    fontSize: '0.78rem',
                    color: 'var(--muted, #5a5a5a)',
                  }}
                >
                  Anything you want to track — daily, weekly, or monthly. Telegram can remind you on the schedule you pick.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  background: 'transparent',
                  border: 0,
                  color: 'var(--muted, #5a5a5a)',
                  cursor: 'pointer',
                  fontSize: 22,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '1rem 1.2rem', display: 'grid', gap: '0.85rem' }}>
              {/* Label */}
              <Field label="Metric name" hint="e.g. Door Knocks, Outbound Emails, Demos">
                <input
                  name="label"
                  required
                  maxLength={48}
                  placeholder="Door Knocks"
                  style={inputStyle}
                />
              </Field>

              {/* Description */}
              <Field label="Why this matters" hint="Optional — context the bot can echo back when it nudges you.">
                <textarea
                  name="description"
                  maxLength={240}
                  placeholder="Hit 50/day so my Q3 close rate stays above 12%."
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 56 }}
                />
              </Field>

              {/* Unit + period */}
              <div style={twoCol}>
                <Field label="Unit">
                  <select name="unit" style={inputStyle} defaultValue="count">
                    <option value="count">Count (#)</option>
                    <option value="usd">Dollars ($)</option>
                    <option value="percent">Percent (%)</option>
                    <option value="hours">Hours</option>
                    <option value="minutes">Minutes</option>
                  </select>
                </Field>
                <Field label="Tracking timeframe">
                  <select name="period" style={inputStyle} defaultValue="day">
                    <option value="day">Daily</option>
                    <option value="week">Weekly</option>
                    <option value="month">Monthly</option>
                  </select>
                </Field>
              </div>

              {/* Goal + starting */}
              <div style={twoCol}>
                <Field label="Goal" hint="Per-period target.">
                  <input
                    name="goal"
                    type="number"
                    min={1}
                    max={1_000_000}
                    placeholder="50"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Current progress" hint="Optional — if you're starting mid-cycle.">
                  <input
                    name="starting_value"
                    type="number"
                    min={0}
                    max={1_000_000}
                    placeholder="0"
                    style={inputStyle}
                  />
                </Field>
              </div>

              {/* Target date */}
              <Field label="Target date" hint="Optional deadline. Bot will warn you when you're behind pace.">
                <input name="target_date" type="date" style={inputStyle} />
              </Field>

              {/* Reminders */}
              <div
                style={{
                  border: '1px solid var(--line, #e6e1d8)',
                  borderRadius: 10,
                  padding: '0.8rem 0.9rem',
                  background: 'var(--paper-alt, #f7f4ef)',
                  display: 'grid',
                  gap: '0.7rem',
                }}
              >
                <div>
                  <strong style={{ fontSize: '0.92rem' }}>Telegram reminders</strong>
                  <p
                    style={{
                      margin: '0.15rem 0 0',
                      fontSize: '0.78rem',
                      color: 'var(--muted, #5a5a5a)',
                    }}
                  >
                    The bot pings you on the schedule you pick — quoting your &ldquo;why this matters&rdquo; line and current pace.
                  </p>
                </div>
                <Field label="How often">
                  <select
                    name="reminder_cadence"
                    value={cadence}
                    onChange={(e) =>
                      setCadence(e.target.value as 'none' | 'daily' | 'weekdays' | 'weekly')
                    }
                    style={inputStyle}
                  >
                    <option value="none">No reminders</option>
                    <option value="daily">Every day</option>
                    <option value="weekdays">Weekdays only (Mon–Fri)</option>
                    <option value="weekly">Once a week</option>
                  </select>
                </Field>

                {cadence !== 'none' && (
                  <div style={twoCol}>
                    <Field label="Time of day">
                      <input
                        name="reminder_time"
                        type="time"
                        defaultValue="08:30"
                        style={inputStyle}
                      />
                    </Field>
                    {cadence === 'weekly' && (
                      <Field label="Day of week">
                        <select name="reminder_dow" style={inputStyle} defaultValue="1">
                          <option value="1">Monday</option>
                          <option value="2">Tuesday</option>
                          <option value="3">Wednesday</option>
                          <option value="4">Thursday</option>
                          <option value="5">Friday</option>
                          <option value="6">Saturday</option>
                          <option value="0">Sunday</option>
                        </select>
                      </Field>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '0.9rem 1.2rem',
                borderTop: '1px solid var(--line, #e6e1d8)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.5rem',
                background: 'var(--paper-alt, #f7f4ef)',
              }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  padding: '0.55rem 0.95rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  background: 'transparent',
                  color: 'var(--ink, #0f0f0f)',
                  border: '1px solid var(--line, #e6e1d8)',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                style={{
                  padding: '0.55rem 1.1rem',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  background: pending ? 'var(--red-deep, #c21a00)' : 'var(--red, #ff2800)',
                  color: '#fff',
                  border: 0,
                  borderRadius: 8,
                  cursor: pending ? 'wait' : 'pointer',
                  letterSpacing: '0.02em',
                  minWidth: 120,
                }}
              >
                {pending ? 'Adding…' : 'Add KPI'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--ink, #0f0f0f)' }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ fontSize: '0.72rem', color: 'var(--muted, #5a5a5a)', lineHeight: 1.45 }}>
          {hint}
        </span>
      )}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.7rem',
  border: '1px solid var(--line, #e6e1d8)',
  borderRadius: 8,
  fontSize: '0.9rem',
  background: 'var(--paper, #fff)',
  color: 'var(--ink, #0f0f0f)',
  width: '100%',
  fontFamily: 'inherit',
}

const twoCol: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0.7rem',
}
