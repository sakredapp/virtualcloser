import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { LogoCorner } from './components/Logo'
import NavMenu from './components/NavMenu'
import PublicActionsMenu from './components/PublicActionsMenu'
import { brandFromHost } from '@/lib/brand'

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host')
  const brand = brandFromHost(host)
  return {
    title: brand.name,
    description: brand.tagline,
    openGraph: {
      title: brand.name,
      description: brand.tagline,
      images: [brand.logo.ogSrc],
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host')
  const brand = brandFromHost(host)
  return (
    <html lang="en" data-brand={brand.key}>
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
