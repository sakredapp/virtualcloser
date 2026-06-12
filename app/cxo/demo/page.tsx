import type { Metadata } from 'next'
import CxoDemo from './CxoDemo'

// Public, no-auth demo of the CXO Suite executive dashboard. Lives under the
// /cxo (public) prefix so middleware never gates it. On suitecxo.com the
// middleware redirects /demo → /cxo/demo so the short URL works too.
//
// NOT force-static: the root layout's social tags come from resolveBrand(),
// which reads the request host. A statically-rendered page has no host at
// build time and falls back to the Virtual Closer brand — which is exactly
// why the iMessage/Slack preview showed the VC logo. We render dynamically
// AND pin the CXO social card explicitly below so the share preview is
// correct regardless of host, redirects, or crawler behavior.
export const dynamic = 'force-dynamic'

const CXO_LOGO =
  'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/cxo%20logo/CXO%20Suite.png'
const CXO_ORIGIN = 'https://suitecxo.com'
const TITLE = 'CXO Suite — Live Demo'
const DESCRIPTION =
  'A hands-on look at the CXO Suite executive dashboard: command center, pipeline, revenue, inbox triage, and calendar — with sample data.'

export const metadata: Metadata = {
  metadataBase: new URL(CXO_ORIGIN),
  title: TITLE,
  description: DESCRIPTION,
  // Pin the favicon/touch icon to CXO so it overrides the VC default the
  // root layout sets.
  icons: { icon: CXO_LOGO, shortcut: CXO_LOGO, apple: CXO_LOGO },
  openGraph: {
    type: 'website',
    url: `${CXO_ORIGIN}/demo`,
    siteName: 'CXO Suite',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: CXO_LOGO, alt: 'CXO Suite' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [CXO_LOGO],
  },
}

export default function CxoDemoPage() {
  return <CxoDemo />
}
