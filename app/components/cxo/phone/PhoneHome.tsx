import type { PhoneVersion } from '@/lib/phoneVersions'
import type { MonthToDate } from '@/lib/pinnacle/cache'
import { fmtCount, fmtMoney, fmtPct } from '@/lib/pinnacle/kpis'
import PhoneBookTops, { type BookTopRows } from './PhoneBookTops'
import PhoneCountUp from './PhoneCountUp'
import PhoneLogo from './PhoneLogo'
import { Go } from './PhoneTabBar'
import { MiraOrb } from '@/app/components/mira/MiraOrb'

/**
 * The top of Home on a phone: who and when (the greeting in the serif
 * heading face), one black card with the number that matters (it counts up
 * once on load, PhoneCountUp), one nudge. What the card shows is the version's `home`:
 *   today  the day's work (open to-dos, overdue, meetings, emails to answer)
 *   book   the book of business (issued premium month to date, placement)
 * Every figure is one the page already loaded; a figure with no source is
 * left out, never guessed. Phone width only (.cxph-only).
 */
export type PhoneHomeProps = {
  version: PhoneVersion
  /** The signed-in company's own name and logo (the wordmark when the version has none). */
  companyName: string | null
  logoUrl?: string | null
  firstName: string | null
  greeting: string
  dateLabel: string
  today: { open: number; overdue: number; meetings: number | null; needReply: number | null }
  /** Month to date from the stored rollup; null when the viewer may not see it or there is nothing to show. */
  book: MonthToDate | null
  /** The viewer may see revenue (not an exec's assistant). */
  canSeeBook: boolean
  /** Approvals waiting; null when approvals are off for the company. */
  approvalsWaiting: number | null
  /** The viewer's own inbox; null outside the Pinnacle edition (no email in Suite CXO). */
  inboxHref: string | null
  googleOn: boolean
  /** The public demo: where its links go, and the top lists handed in (no request is made). */
  demo?: { approvalsHref: string; revenueHref: string; tops: BookTopRows }
  /** The assistant's name for this viewer (the setting, resolved on the server); else the version's default. */
  assistantName?: string
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '·'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** "$1.2M" as a big figure with a small leading dollar sign. */
function Big({ money }: { money: string }) {
  const neg = money.startsWith('-')
  const rest = money.replace(/^-?\$/, '')
  return (
    <div className="big">
      {neg && '-'}
      <sup>$</sup>
      <PhoneCountUp text={rest} />
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export default function PhoneHome(p: PhoneHomeProps) {
  const { version: v, today, book } = p
  const aiName = p.assistantName || v.assistantName
  const mark = v.wordmark ?? p.companyName ?? v.appName
  const logo = v.logoSrc ?? (v.wordmark ? null : p.logoUrl ?? null)
  const placement = book && book.premium > 0 ? book.issued / book.premium : null

  const nudge =
    p.approvalsWaiting && p.approvalsWaiting > 0
      ? { bold: `${plural(p.approvalsWaiting, 'thing needs', 'things need')} your OK.`, rest: `${aiName} is waiting on you.`, href: p.demo?.approvalsHref ?? '/dashboard/approvals', cta: 'Review' }
      : p.inboxHref && today.needReply && today.needReply > 0
        ? { bold: `${plural(today.needReply, 'email needs', 'emails need')} a reply.`, rest: `${aiName} can draft them.`, href: p.inboxHref, cta: 'Open' }
        : null

  return (
    <div className="cxph cxph-only cxph-home">
      <p className="cxph-brand">
        {v.mark ? (
          <PhoneLogo mark={v.mark} />
        ) : logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={mark} />
        ) : mark}
      </p>
      <div className="cxph-greet">
        <span className="cxph-avatar ink" aria-hidden>{initialsOf(p.firstName)}</span>
        <span className="who">
          <small>{p.dateLabel}</small>
          <b>{p.firstName ? `${p.greeting}, ${p.firstName}` : p.greeting}</b>
        </span>
      </div>

      {v.home === 'book' && p.canSeeBook ? (
        book ? (
          <section className="cxph-hero" aria-label={`${v.words.issued}, ${book.monthName} to date`}>
            <div className="cap">
              <span>{v.words.hero}</span>
              <span>{book.monthShort} 1 to {book.throughDay}</span>
            </div>
            <Big money={fmtMoney(book.issued)} />
            <p className="verdict">
              <b>{fmtPct(placement)} {v.words.placed ?? 'placed'}.</b> {fmtMoney(book.premium)} {v.words.submittedShort ?? 'submitted'} this month across {fmtCount(book.policies)} {v.words.policies}.
            </p>
            <div className="pace">
              <div className="cxph-track" role="img" aria-label={`${v.words.placement} ${fmtPct(placement)}`}>
                <i style={{ width: `${Math.max(0, Math.min(100, (placement ?? 0) * 100))}%` }} />
              </div>
              <div className="legend">
                <span>{v.words.placement} {fmtPct(placement)}</span>
                <span>{v.words.submitted} {fmtMoney(book.premium)}</span>
              </div>
            </div>
            {(book.prior.premium > 0 || book.prior.issued > 0) && (
              <div className="cxph-split">
                <div>
                  <b>{fmtMoney(book.prior.issued)}</b>
                  <small>{v.words.issuedShort ?? 'Issued'}, {book.prior.monthShort} 1 to {book.throughDay}</small>
                </div>
                <div>
                  <b>{fmtMoney(book.prior.premium)}</b>
                  <small>{v.words.submittedShort ? v.words.submittedShort.charAt(0).toUpperCase() + v.words.submittedShort.slice(1) : 'Submitted'}, {book.prior.monthShort} 1 to {book.throughDay}</small>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="cxph-hero" aria-label={v.words.issued}>
            <div className="cap"><span>{v.words.hero}</span></div>
            <p className="verdict" style={{ marginTop: 14 }}>
              <b>This month&rsquo;s numbers are not in yet.</b> They show here as soon as the book has synced.
            </p>
          </section>
        )
      ) : (
        <section className="cxph-hero" aria-label="What needs you today">
          <div className="cap">
            <span>{v.words.hero}</span>
            <span>{p.dateLabel.split(',')[0]}</span>
          </div>
          <div className="big">
            <PhoneCountUp text={String(today.open)} />
            <small>{today.open === 1 ? 'open to-do' : 'open to-dos'}</small>
          </div>
          <p className="verdict">
            {today.overdue > 0 ? <b>{plural(today.overdue, 'is', 'are')} overdue. </b> : today.open > 0 ? <b>Nothing is overdue. </b> : <b>Your list is clear. </b>}
            {[
              today.meetings === null ? null : today.meetings === 0 ? 'No meetings today' : plural(today.meetings, 'meeting today', 'meetings today'),
              today.needReply === null ? null : today.needReply === 0 ? 'no emails waiting on a reply' : `${plural(today.needReply, 'email needs', 'emails need')} a reply`,
            ].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())}
            {today.meetings !== null || today.needReply !== null ? '.' : ''}
          </p>
          {today.open > 0 && (
            <div className="pace">
              <div className="cxph-track" role="img" aria-label={`${today.overdue} of ${today.open} overdue`}>
                <i style={{ width: `${Math.max(0, Math.min(100, ((today.open - today.overdue) / today.open) * 100))}%` }} />
              </div>
              <div className="legend">
                <span>{today.open - today.overdue} on time</span>
                <span>{today.overdue} overdue</span>
              </div>
            </div>
          )}
        </section>
      )}

      {nudge && (
        <div className="cxph-card cxph-nudge">
          <MiraOrb className="cxph-orb" size={28} decorative />
          <p><b>{nudge.bold}</b> {nudge.rest}</p>
          <Go href={nudge.href} className="cxph-btn sm">{nudge.cta}</Go>
        </div>
      )}

      {v.home === 'book' && p.canSeeBook && book && (
        <PhoneBookTops
          start={`${book.dataThrough.slice(0, 8)}01`}
          end={book.dataThrough}
          scope={`${v.words.scope ?? 'Submitted premium'}, ${book.monthShort} 1 to ${book.throughDay}`}
          lists={[
            { dim: 'team', title: v.words.agencies },
            { dim: 'agent', title: v.words.producers },
            { dim: 'carrier', title: v.words.carriers },
          ]}
          revenueHref={p.demo?.revenueHref}
          preset={p.demo?.tops}
          units={v.words.unit ? [v.words.unit, v.words.policies] : undefined}
        />
      )}

      {!p.googleOn && (
        <p className="cxph-conn">
          <a href="/api/google/oauth/start?return=%2Fdashboard">Google is not connected. Connect it</a>{p.inboxHref ? ' to see meetings and email here.' : ' to see your meetings here.'}
        </p>
      )}

      <div className="cxph-sec">
        <b>What needs you, in order</b>
        <span>{today.open} open</span>
      </div>
    </div>
  )
}
