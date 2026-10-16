import type { Metadata } from 'next'
import { demoEdition } from '@/lib/phoneVersions'
import CxoDemo from './CxoDemo'

// Public, no-auth demo of the Suite CXO executive dashboard. Lives under the
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
const CXO_ORIGIN = 'https://www.suitecxo.com'
const TITLE = 'Suite CXO — Live Demo'
const DESCRIPTION =
  'A hands-on look at the Suite CXO executive dashboard: overview, performance, reports, calendar, recordings and integrations — with sample data.'

export const metadata: Metadata = {
  metadataBase: new URL(CXO_ORIGIN),
  title: { absolute: TITLE },
  // Open by link, kept out of search and AI answers: every number here is
  // sample data and must never be quoted as Suite CXO's own (lib/seo.ts;
  // middleware also sends X-Robots-Tag: noindex).
  robots: { index: false, follow: true },
  alternates: { canonical: '/cxo/demo' },
  description: DESCRIPTION,
  // Pin the favicon/touch icon to CXO so it overrides the VC default the
  // root layout sets.
  icons: { icon: CXO_LOGO, shortcut: CXO_LOGO, apple: CXO_LOGO },
  openGraph: {
    type: 'website',
    url: `${CXO_ORIGIN}/cxo/demo`,
    siteName: 'Suite CXO',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: CXO_LOGO, alt: 'Suite CXO' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [CXO_LOGO],
  },
}

// ?version=book shows the second phone version, the one whose Home leads with
// the book of business (lib/phoneVersions). Sample data and the invented demo
// company either way; the choice only matters at phone width.
// ?edition=<key> (local dev server only, lib/phoneVersions demoEdition) shows a client's own
// look over the same sample data; deployed builds ignore it.
export default async function CxoDemoPage({ searchParams }: { searchParams?: Promise<{ version?: string | string[]; edition?: string | string[] }> }) {
  const sp = await searchParams
  const raw = sp?.version
  const version = (Array.isArray(raw) ? raw[0] : raw) === 'book' ? 'book' : 'today'
  const edition = demoEdition(sp?.edition, process.env.NODE_ENV)
  return <CxoDemo version={version} edition={edition} />
}
