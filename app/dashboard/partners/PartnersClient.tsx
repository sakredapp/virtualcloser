'use client'

import { useMemo } from 'react'
import PartnersBoard, { fetchPartnersApi } from '@/app/components/cxo/PartnersBoard'
import type { Partner } from '@/lib/partnersShared'

export default function PartnersClient({ initial }: { initial: Partner[] }) {
  const api = useMemo(() => fetchPartnersApi(), [])
  return <PartnersBoard api={api} initial={initial} />
}
