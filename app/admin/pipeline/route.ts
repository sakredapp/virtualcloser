/** /admin/pipeline: deleted 2026-10-19 with /admin/prospects; same redirect. */
import { NextResponse } from 'next/server'
import { accountsOnboardingUrl } from '@/lib/accountsLinks'

export const dynamic = 'force-dynamic'

const go = () => NextResponse.redirect(accountsOnboardingUrl(), 308)

export const GET = go
export const HEAD = go
