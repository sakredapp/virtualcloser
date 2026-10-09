'use client'

import type { TodoKind, TodoPriority } from '@/lib/today'

export type AnyKind = TodoKind | 'project'

export const KIND_LABEL: Record<AnyKind, string> = {
  email: 'Follow-up email',
  call: 'Call',
  prep: 'Meeting prep',
  team: 'Team / agent issue',
  project: 'Project',
  personal: 'Personal',
  task: 'To-do',
}
export const KIND_SHORT: Record<AnyKind, string> = { email: 'Email', call: 'Call', prep: 'Prep', team: 'Team', project: 'Project', personal: 'Personal', task: 'To-do' }
export const PRIORITY_LABEL: Record<TodoPriority, string> = { high: 'High', normal: 'Normal', low: 'Low' }

/** 16px line icons, charcoal (currentColor). */
export function KindIcon({ kind, size = 16 }: { kind: AnyKind; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (kind) {
    case 'email':
      return (
        <svg {...p}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
        </svg>
      )
    case 'call':
      return (
        <svg {...p}>
          <path d="M5 4h3.5l1.5 4.5-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z" />
        </svg>
      )
    case 'prep':
      return (
        <svg {...p}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      )
    case 'team':
      return (
        <svg {...p}>
          <circle cx="9" cy="9" r="3.2" />
          <path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
          <path d="M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.4c1.8.6 3 2.2 3.5 4.6" />
        </svg>
      )
    case 'project':
      return (
        <svg {...p}>
          <rect x="3.5" y="4" width="17" height="16" rx="2" />
          <path d="M9.5 4v16M15 4v9" />
        </svg>
      )
    case 'personal':
      return (
        <svg {...p}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
        </svg>
      )
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
        </svg>
      )
  }
}
