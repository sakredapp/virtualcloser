import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import PageHeader from '@/app/components/PageHeader'
import { isNativeAppUA } from '@/lib/nativeApp'

export const dynamic = 'force-dynamic'

/**
 * What the store app shows in place of the billing pages. No link, no price,
 * no button: the app stores do not allow an app to point at where a plan is
 * sold. In a browser this page is not used; it sends the person home.
 */
export default async function PlanOnWebPage() {
  if (!isNativeAppUA((await headers()).get('user-agent'))) redirect('/dashboard')
  return (
    <main className="wrap">
      <PageHeader eyebrow="Settings" title="Your plan" subtitle="Plans are managed on the web." />
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <p style={{ margin: 0 }}>
          Your company&rsquo;s plan cannot be viewed or changed in this app. To manage your plan, sign in to Suite CXO on the web.
        </p>
        <p className="meta" style={{ margin: '0.6rem 0 0' }}>
          Everything else in your account works here as usual.
        </p>
      </section>
    </main>
  )
}
