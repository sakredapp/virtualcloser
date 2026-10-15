import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { Lora, Inter, Instrument_Sans } from 'next/font/google'
import './globals.css'
import './components/cxo/phone/cxo-phone-fit.css'
import { LogoCorner } from './components/Logo'
import NavMenu from './components/NavMenu'
import PublicActionsMenu from './components/PublicActionsMenu'
import { THEME_SCRIPT } from './components/cxo/themeScript'
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

// Executive-suite product typography: Instrument Sans headings (the Score /
// Pinnacle face, tight tracking), Inter tabular body (owner 2026-10-15: no Lora
// in the apps). Lora stays loaded ONLY for the public suitecxo.com site
// (app/cxo/site.css pins it there). Exposed as variables; globals.css applies
// them under the CXO app shell.
// Lora and Instrument Sans are not preloaded: each public page uses only one of
// them (home: Lora headings; sign-in: an Instrument Sans title), so preloading
// both put an unused ~40KB file ahead of first paint on every page. The text
// that paints first is Inter. Both still load on first use (display: swap).
const cxoLora = Lora({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-lora', display: 'swap', preload: false })
const cxoInter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
// Instrument Sans: every CXO app heading (--cx-serif) and Pinnacle's whole face.
const pinnacleSans = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument-sans', display: 'swap', preload: false })
const fontVars = `${cxoLora.variable} ${cxoInter.variable} ${pinnacleSans.variable}`

// Tints the mobile browser address bar + PWA splash to match the brand.
// iOS Safari + Chrome on Android both honor this. Next 15 wants it on the
// viewport export, not metadata.
export async function generateViewport(): Promise<Viewport> {
  const brand = await resolveBrand()
  // Suite CXO draws under the notch and the home indicator (it ships as a
  // phone app), and pads for them itself with env(safe-area-inset-*).
  return brand.key === 'cxo'
    ? { themeColor: brand.theme.accent, viewportFit: 'cover' }
    : { themeColor: brand.theme.accent }
}

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
      <html lang="en" data-brand={brand.key} className={fontVars}>
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
    // data-theme is set before first paint by THEME_SCRIPT (light by default),
    // so the attribute differs from the server render on purpose.
    <html lang="en" data-brand={brand.key} data-theme="light" className={fontVars} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div className="cxo-shell">{children}</div>
      </body>
    </html>
  )
}
