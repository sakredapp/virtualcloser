/**
 * /admin/prospects and /admin/prospects/<id>: deleted 2026-10-19 (Suite CXO
 * prospects were stale and are not carried over). Old admin emails linked
 * here, so the URL answers with a permanent redirect to the onboarding list
 * in Accounts, where demo requests and signups are the Lead stage.
 */
import { NextResponse } from 'next/server'
import { accountsOnboardingUrl } from '@/lib/accountsLinks'

export const dynamic = 'force-dynamic'

const go = () => NextResponse.redirect(accountsOnboardingUrl(), 308)

export const GET = go
export const HEAD = go
