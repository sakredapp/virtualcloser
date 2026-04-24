import type { Metadata } from 'next'
import './globals.css'
import { LogoCorner } from './components/Logo'

export const metadata: Metadata = {
  title: 'Virtual Closer',
  description: 'AI Sales Command Center',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Virtual Closer',
    description: 'AI Sales Command Center',
    images: ['/logo.svg'],
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
        {children}
      </body>
    </html>
  )
}
