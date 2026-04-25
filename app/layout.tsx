import type { Metadata } from 'next'
import './globals.css'
import { LogoCorner } from './components/Logo'
import NavMenu from './components/NavMenu'

export const metadata: Metadata = {
  title: 'Virtual Closer',
  description: 'AI Sales Command Center',
  openGraph: {
    title: 'Virtual Closer',
    description: 'AI Sales Command Center',
    images: ['/logo.png'],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <LogoCorner />
        <NavMenu />
        {children}
      </body>
    </html>
  )
}
