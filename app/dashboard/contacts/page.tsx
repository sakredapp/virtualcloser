import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isGatewayHost, requireTenant, getCurrentMember } from '@/lib/tenant'
import { buildDashboardTabs } from '../dashboardTabs'
import DashboardNav from '../DashboardNav'
import { supabase } from '@/lib/supabase'
import ContactsClient from './ContactsClient'

export const dynamic = 'force-dynamic'

export default async function ContactsPage() {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  let tenant
  try {
    tenant = await requireTenant()
  } catch {
    redirect('/login')
  }

  const member = await getCurrentMember()
  const navTabs = await buildDashboardTabs(tenant.id, member)

  const { data } = await supabase
    .from('rep_contacts')
    .select('id, display_name, aliases, email, phone, role, source, created_at')
    .eq('rep_id', tenant.id)
    .order('display_name', { ascending: true })
    .limit(500)

  type ContactRow = {
    id: string
    display_name: string
    aliases: string[] | null
    email: string | null
    phone: string | null
    role: string | null
    source: string | null
    created_at: string
  }

  const contacts = ((data ?? []) as ContactRow[]).map((r) => ({
    id: r.id,
    display_name: r.display_name,
    aliases: r.aliases ?? [],
    email: r.email,
    phone: r.phone,
    role: r.role,
    source: r.source,
    created_at: r.created_at,
  }))

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Directory</p>
          <h1>Contacts</h1>
          <p className="sub">
            People the Plaud agent can resolve by name. Used to assign tasks and
            draft emails when a recording mentions someone.
          </p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <ContactsClient initialContacts={contacts} />
    </main>
  )
}
