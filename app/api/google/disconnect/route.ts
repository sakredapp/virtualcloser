import { NextResponse } from 'next/server'
import { disconnectRep } from '@/lib/google'
import { getSessionSlug } from '@/lib/client-auth'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export async function POST() {
  const slug = await getSessionSlug()
  if (!slug) return NextResponse.json({ ok: false }, { status: 401 })
  const { data: rep } = await supabase
    .from('reps')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (!rep) return NextResponse.json({ ok: false }, { status: 404 })
  await disconnectRep(rep.id)
  return NextResponse.redirect(`https://${slug}.${ROOT_DOMAIN}/dashboard?gcal=disconnected`, 303)
}
