import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Cormorant_Garamond } from 'next/font/google'
import './globals.css'
import { LogoCorner } from './components/Logo'
import NavMenu from './components/NavMenu'
import PublicActionsMenu from './components/PublicActionsMenu'
import { brandFromHost, getBrand, isAnyGatewayHost, type BrandConfig } from '@/lib/brand'

// Resolve the brand for the chrome. Prefer the authenticated tenant's stored
// brand so a CXO tenant always renders CXO chrome — even when its portal is
// reached on a non-suitecxo host (admin "view portal" redirects every tenant to
// {slug}.virtualcloser.com). On gateway/apex/marketing hosts there's no tenant
// subdomain, so brand strictly from host (and skip the tenant lookup).
async function resolveBrand(): Promise<BrandConfig> {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host')
  if (isAnyGatewayHost(host)) return brandFromHost(host)
  try {
    const { getCurrentTenant } = await import('@/lib/tenant')
    const tenant = await getCurrentTenant()
    if (tenant?.brand) return getBrand(tenant.brand)
  } catch {
    // No tenant context (or lookup failed) — fall through to host brand.
  }
  return brandFromHost(host)
}

// CXO display serif. Loaded once server-side, exposed as a CSS variable
// so globals.css can apply it under [data-brand='cxo'] without touching
// VirtualCloser. `display: 'swap'` avoids invisible text while loading;
// next/font self-hosts the file so there's no CLS or Google ping at runtime.
const cxoSerif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-cxo-serif',
  display: 'swap',
})

export async function generateMetadata(): Promise<Metadata> {
  const brand = await resolveBrand()

  // metadataBase makes any relative og:image / icon get resolved against the
  // BRAND's own apex (not the deployment domain). Without this, iMessage/
  // Slack/Twitter previews fall back to the VC favicon at app/icon.png
  // regardless of which domain the link was shared from.
  const origin = `https://${brand.rootDomain}`

  return {
    metadataBase: new URL(origin),
    title: brand.name,
    description: brand.description,
    icons: {
      // Override the auto-detected app/icon.png with the brand's own mark so
      // iMessage / browser tabs / Slack favicons all show the right logo.
      icon: brand.logo.markSrc,
      shortcut: brand.logo.markSrc,
      apple: brand.logo.markSrc,
    },
    // Tints the mobile browser address bar + PWA splash to match the brand.
    // iOS Safari + Chrome on Android both honor this — without it the bar
    // stays system-default and breaks the brand frame on phones.
    themeColor: brand.theme.accent,
    appleWebApp: {
      title: brand.name,
      statusBarStyle: 'default',
    },
    openGraph: {
      type: 'website',
      url: origin,
      siteName: brand.name,
      title: brand.name,
      description: brand.description,
      images: [
        {
          url: brand.logo.ogSrc,
          alt: brand.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: brand.name,
      description: brand.description,
      images: [brand.logo.ogSrc],
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const brand = await resolveBrand()

  // VirtualCloser keeps its bordered red site-shell + corner mark + nav.
  // CXO Suite ships a fully separate visual identity — no red frame, no
  // VC corner logo, no VC nav menu — so the CXO surface can be designed
  // and customized independently without inheriting any VC chrome.
  if (brand.key === 'virtualcloser') {
    return (
      <html lang="en" data-brand={brand.key} className={cxoSerif.variable}>
        <body>
          <div className="site-shell">
            <LogoCorner />
            <NavMenu />
            <PublicActionsMenu />
            {children}
          </div>
        </body>
      </html>
    )
  }

  return (
    <html lang="en" data-brand={brand.key} className={cxoSerif.variable}>
      <body>
        <div className="cxo-shell">{children}</div>
      </body>
    </html>
  )
}
