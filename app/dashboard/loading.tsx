'use client'

import { usePathname } from 'next/navigation'
import PageSkeleton from '@/app/components/cxo/PageSkeleton'

// The nearest loading screen for every page without its own: name the page
// being opened, not the home page.
const NAMES: Array<[string, string]> = [
  ['/dashboard/plan', 'Sales Plan'],
  ['/dashboard/employees', 'Employees'],
  ['/dashboard/execs', 'Execs'],
  ['/dashboard/partners', 'Partners'],
  ['/dashboard/calendar', 'Calendar'],
  ['/dashboard/meetings', 'Meetings'],
  ['/dashboard/boards', 'Boards'],
  ['/dashboard/integrations', 'Integrations'],
  ['/dashboard/settings', 'Settings'],
]

export default function Loading() {
  const path = usePathname() ?? '/dashboard'
  const name = path === '/dashboard' ? 'Today' : NAMES.find(([p]) => path.startsWith(p))?.[1] ?? 'Loading'
  return <PageSkeleton eyebrow={name} title={name} numbers={false} />
}
