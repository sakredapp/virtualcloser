'use client'

import { useMemo } from 'react'
import PartnersBoard, { fetchPartnersApi } from '@/app/components/cxo/PartnersBoard'
import type { DirectoryScope, Partner } from '@/lib/partnersShared'

export default function PartnersClient({ initial, scope = 'partners' }: { initial: Partner[]; scope?: DirectoryScope }) {
  const api = useMemo(() => fetchPartnersApi(), [])
  return <PartnersBoard api={api} initial={initial} scope={scope} />
}
