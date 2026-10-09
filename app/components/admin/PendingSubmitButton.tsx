'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * A submit button that disables itself while its form's server action runs,
 * so a double click cannot fire the action twice. The server still guards
 * (login links: lib/loginLinkSend refuses a second send inside 2 minutes).
 */
export default function PendingSubmitButton({
  children,
  pendingLabel = 'Sending…',
  className = 'btn approve',
  disabled = false,
}: {
  children: ReactNode
  pendingLabel?: ReactNode
  className?: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  )
}
