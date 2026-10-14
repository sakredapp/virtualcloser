import { BRAND_MARKS } from '@/lib/brandMarks'
import type { PhoneMarkKey } from '@/lib/phoneVersions'

/**
 * A company's own logo lockup on the phone Home: the vector mark (current
 * text colour, so it follows light and dark) beside the two-line name, as the
 * company's own site sets it. Phone width only (rendered inside .cxph-brand).
 */
export default function PhoneLogo({ mark }: { mark: PhoneMarkKey }) {
  const m = BRAND_MARKS[mark]
  return (
    <span className="cxph-logo" role="img" aria-label={m.label}>
      <svg viewBox={m.viewBox} aria-hidden="true" focusable="false">
        <path d={m.path} fill="currentColor" fillRule="evenodd" />
      </svg>
      <span className="cxph-logo__words" aria-hidden="true">
        <b>{m.lockup[0]}</b>
        <small>{m.lockup[1]}</small>
      </span>
    </span>
  )
}
