'use client'
/**
 * Settings › About you (Suite CXO). Your role and what you want to keep an eye
 * on, the same two questions the first-day card asks once. The assistant
 * leads with these when you ask "how are we doing" and similar.
 */
import { useRouter } from 'next/navigation'
import { useAssistantName } from '@/app/components/AssistantNameProvider'
import AboutYouPicker from '@/app/components/cxo/AboutYouPicker'
import type { AboutView } from '@/lib/onboarding/aboutYouShared'
import '../cxo-alerts.css'

export default function AboutYouCard({ initial }: { initial: AboutView }) {
  const router = useRouter()
  const assistantName = useAssistantName()
  return (
    <section className="card cx-alerts-card" id="about-you" style={{ marginTop: '0.8rem' }}>
      <div className="section-head">
        <h2>About you</h2>
        <p>so {assistantName} leads with what matters to you</p>
      </div>
      <AboutYouPicker initial={initial} mode="profile" assistantName={assistantName} onSaved={() => router.refresh()} />
    </section>
  )
}
