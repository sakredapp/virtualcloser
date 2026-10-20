/**
 * The CXO onboarding step list (Deel "Sign a document" pattern): a vertical
 * list of numbered step cards with a one-line hint and a status chip, so the
 * steps never wrap into a ragged row on a phone. Pure markup, no hooks, so the
 * client sign step and the server pay state can both render it.
 */
export type CxStepStatus = 'done' | 'now' | 'next'

export type CxStep = { title: string; hint: string; status: CxStepStatus }

const CHIP: Record<CxStepStatus, string> = { done: 'Done', now: 'Now', next: 'Next' }

export function cxOnboardSteps(opts: {
  hasBuildFee: boolean
  feeDollars?: string
  current: 'read' | 'sign' | 'pay'
}): CxStep[] {
  const order = ['read', 'sign', 'pay'] as const
  const at = order.indexOf(opts.current)
  const status = (k: (typeof order)[number]): CxStepStatus => {
    const i = order.indexOf(k)
    return i < at ? 'done' : i === at ? 'now' : 'next'
  }
  const steps: CxStep[] = [
    { title: 'Read the agreement', hint: 'Take your time, it is all on this page.', status: status('read') },
    { title: 'Sign with your name', hint: 'Type your full legal name at the end.', status: status('sign') },
  ]
  if (opts.hasBuildFee) {
    steps.push({
      title: 'Pay the setup fee',
      hint: opts.feeDollars ? `One time, $${opts.feeDollars}, paid securely with Whop.` : 'One time, paid securely with Whop.',
      status: status('pay'),
    })
  }
  steps.push({ title: 'Set your password', hint: 'We email you the link right after.', status: 'next' })
  return steps
}

export default function CxOnboardSteps({ steps, compact = false }: { steps: CxStep[]; compact?: boolean }) {
  return (
    <ol className={`cx-steps${compact ? ' cx-steps--compact' : ''}`} aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s.title} className={`cx-step is-${s.status}`} aria-current={s.status === 'now' ? 'step' : undefined}>
          <span className="cx-step-num" aria-hidden="true">
            {s.status === 'done' ? (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
            ) : (
              i + 1
            )}
          </span>
          <span className="cx-step-text">
            <span className="cx-step-title">{s.title}</span>
            {compact ? null : <span className="cx-step-hint">{s.hint}</span>}
          </span>
          <span className="cx-step-chip">{CHIP[s.status]}</span>
        </li>
      ))}
    </ol>
  )
}
