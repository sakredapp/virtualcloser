import type { Metadata } from 'next'
import CxoDemo from './CxoDemo'

// Public, no-auth demo of the CXO Suite executive dashboard. Lives under the
// /cxo (public) prefix so middleware never gates it. On suitecxo.com the
// middleware redirects /demo → /cxo/demo so the short URL works too.
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'CXO Suite — Live Demo',
  description:
    'A hands-on look at the CXO Suite executive dashboard: command center, pipeline, revenue, inbox triage, and calendar — with sample data.',
}

export default function CxoDemoPage() {
  return <CxoDemo />
}
