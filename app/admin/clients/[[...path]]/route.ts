/**
 * /admin/clients, /admin/clients/new, /admin/clients/<id>,
 * /admin/clients/<id>/members and /admin/clients/<id>/cost: retired
 * 2026-10-19. Every client is onboarded and managed in Accounts now; each old
 * URL answers with a permanent (308) redirect there, to the client when the
 * URL names one. The members link on /u/<memberSlug> still points here and
 * lands on that client in Accounts.
 */
import { NextResponse } from 'next/server'
import { accountsUrlForAdminClientsPath } from '@/lib/accountsLinks'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function go(_req: Request, ctx: Ctx) {
  const { path } = await ctx.params
  return NextResponse.redirect(accountsUrlForAdminClientsPath(path), 308)
}

export const GET = go
export const HEAD = go
