import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import { ROLEPLAY_ENABLED, listTrainingDocsForMember } from '@/lib/roleplay'
import { getIntegrationConfig } from '@/lib/client-integrations'
import UsageStrip from '../UsageStrip'
import VoicePromptEditor from '../VoicePromptEditor'
import TrainingDocsManager from '../TrainingDocsManager'
import ScenarioBuilder from './ScenarioBuilder'

export const dynamic = 'force-dynamic'

export default async function RoleplayPage() {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host')
  if (isGatewayHost(host)) redirect('/login')
  const { tenant, member } = await requireMember()
  const navTabs = await buildDashboardTabs(tenant.id, member)

  // Voice prompts (provider-agnostic). Reads the new 'voice_prompts' key
  // first, falls back to legacy 'vapi' key for tenants whose prompt data
  // pre-dates the Vapi scrub.
  const promptCfg =
    (await getIntegrationConfig(tenant.id, 'voice_prompts')) ??
    (await getIntegrationConfig(tenant.id, 'vapi')) ??
    {}
  const promptInitial = {
    product_summary: (promptCfg.product_summary as string) ?? '',
    objections: (promptCfg.objections as string) ?? '',
    confirm_addendum: (promptCfg.confirm_addendum as string) ?? '',
    reschedule_addendum: (promptCfg.reschedule_addendum as string) ?? '',
    roleplay_addendum: (promptCfg.roleplay_addendum as string) ?? '',
    ai_name: (promptCfg.ai_name as string) ?? '',
  }
  let trainingDocs: Array<{
    id: string
    title: string
    doc_kind: string
    scope: 'personal' | 'account'
    is_active: boolean
  }> = []
  try {
    const docs = await listTrainingDocsForMember(tenant.id, member.id)
    trainingDocs = docs.map((d) => ({
      id: d.id,
      title: d.title,
      doc_kind: d.doc_kind,
      scope: d.scope,
      is_active: d.is_active,
    }))
  } catch {
    // table may not exist yet in some envs; degrade gracefully
  }

  // Once a voice provider is wired up and ROLEPLAY_ENABLED=true, this page
  // becomes the live roleplay surface (scenario list + start session + recent
  // sessions for reps; manager review queue for leadership). Until then we
  // show the placeholder below.
  const live = ROLEPLAY_ENABLED

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Roleplay suite{live ? '' : ' · Coming soon'}</p>
          <h1>Train your reps before they touch a real deal.</h1>
          <p className="sub" style={{ marginTop: 0 }}>
            Leadership records the real objections they hear from prospects. We turn
            those plus your product brief into a live AI prospect your reps can
            actually call — voice in, voice out — until they can handle anything
            thrown at them. Every session is recorded turn-by-turn so you can review
            at scale, score reps, and see who&rsquo;s ready before they touch a real
            deal.
          </p>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <div style={{ marginTop: '1.2rem' }}>
        <UsageStrip
          repId={tenant.id}
          candidates={['addon_roleplay_pro', 'addon_roleplay_lite']}
          label="Roleplay minutes"
          blurb="Org-wide pool — every session across your team draws from the same cap."
        />
      </div>

      <div style={{ marginTop: '1.2rem' }}>
        <VoicePromptEditor
          kind="roleplay"
          initial={promptInitial}
          trainingDocs={trainingDocs}
        />
      </div>

      <ScenarioBuilder />

      <div style={{ marginTop: '1.4rem' }}>
        <TrainingDocsManager
          heading="Roleplay training docs"
          allowedKinds={['product_brief', 'script', 'objection_list', 'case_study', 'training', 'reference']}
        />
      </div>

      <section className="card" style={{ marginTop: '1.4rem', padding: '1.2rem 1.2rem 1rem' }}>
        <h2 style={{ margin: '0 0 0.6rem', fontSize: 18 }}>What ships when this goes live</h2>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div>
            <p className="name">Build the scenario once</p>
            <p className="meta">A manager pastes (or voice-notes) the product brief and the most common objections. The AI prospect uses those exact objections, in your exact words.</p>
          </div></li>
          <li className="row"><div>
            <p className="name">Reps practice live</p>
            <p className="meta">Pick a scenario, hit start, talk to the AI like it&rsquo;s a real call. It pushes back, stalls, asks for discounts, hangs up early — whatever the real objection bank says it should do.</p>
          </div></li>
          <li className="row"><div>
            <p className="name">Difficulty dial</p>
            <p className="meta">Easy / Standard / Hard / Brutal. Start a new rep on Easy, get them to Brutal before they go live.</p>
          </div></li>
          <li className="row"><div>
            <p className="name">Auto-debrief</p>
            <p className="meta">After each session: a score, what they handled well, what they choked on, and a transcript. Sent to the rep instantly.</p>
          </div></li>
          <li className="row"><div>
            <p className="name">Manager review queue at scale</p>
            <p className="meta">Every session lands in your review queue. Skim the AI debrief, jump to the moments that matter, leave a verdict (ready / needs work / escalate) and notes. The rep sees your call.</p>
          </div></li>
          <li className="row"><div>
            <p className="name">Leaderboard + readiness</p>
            <p className="meta">See who&rsquo;s practiced this week, who&rsquo;s ready, and who needs another round before you put them on a real call.</p>
          </div></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem', padding: '1rem 1.2rem' }}>
        <p className="meta" style={{ margin: 0 }}>
          We&rsquo;re finishing the voice integration. If you want early access for
          your team, reply to your last onboarding email and we&rsquo;ll add you
          to the pilot list.
        </p>
        <div style={{ marginTop: '0.8rem' }}>
          <Link href="/dashboard" className="btn">← Back to dashboard</Link>
        </div>
      </section>
      {/* Spacer */}
      <div style={{ height: 0 }} />
    </main>
  )
}
