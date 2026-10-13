import { Go } from './PhoneTabBar'

/**
 * Approvals at the top of Work, as its own card: how many are waiting and one
 * tap to review them. The count is the same one the tab bar's badge shows
 * (pending approvals plus meeting-note drafts). Used by the Work page and by
 * the public demo.
 */
export default function PhoneApprovalsCard({ href, waiting, assistantName }: { href: string; waiting: number; assistantName: string }) {
  return (
    <Go href={href} className="cxph-card cxph-apprcard" aria-label={waiting > 0 ? `Approvals, ${waiting} waiting for your OK` : 'Approvals, nothing waiting'}>
      <span className="fig" aria-hidden>{waiting}</span>
      <span className="t">
        <b>{waiting === 1 ? 'Approval waiting' : 'Approvals waiting'}</b>
        <small>{waiting > 0 ? `${assistantName} holds ${waiting === 1 ? 'it' : 'these'} until you say OK.` : `Nothing needs your OK. ${assistantName} will ask here when something does.`}</small>
      </span>
      <span className={waiting > 0 ? 'cxph-btn sm' : 'cxph-btn sm ghost'}>{waiting > 0 ? 'Review' : 'Open'}</span>
    </Go>
  )
}
