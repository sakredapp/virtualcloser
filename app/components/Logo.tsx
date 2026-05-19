import Link from 'next/link'
import { headers } from 'next/headers'
import { brandFromHost } from '@/lib/brand'

type Props = {
  /** Rendered height in px. Width is derived from the brand's wordmark aspect ratio. */
  size?: number
  noLink?: boolean
  alt?: string
  className?: string
  style?: React.CSSProperties
}

/**
 * Brand wordmark. `size` = height in px; width follows the brand's wordmark
 * aspect ratio. Reads the current request's brand from headers so the right
 * asset is rendered for VirtualCloser vs CXO Suite without a prop drill.
 */
export async function Logo({ size = 56, noLink, alt, className, style }: Props) {
  const h = await headers()
  const brand = brandFromHost(h.get('x-tenant-host') ?? h.get('host'))
  const height = size
  const width = Math.round(size * brand.logo.wordmarkRatio)
  const label = alt ?? brand.name
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={brand.logo.wordmarkSrc}
      alt={label}
      width={width}
      height={height}
      className={className}
      style={{
        display: 'block',
        height,
        width: 'auto',
        ...style,
      }}
    />
  )
  if (noLink) return img
  return (
    <Link href="/" aria-label={`${brand.name} home`} style={{ display: 'inline-block' }}>
      {img}
    </Link>
  )
}

/**
 * Top-left corner mark: sits at the top of the page, scrolls away with content.
 * Uses the brand's square mark for compactness.
 */
export async function LogoCorner() {
  const h = await headers()
  const brand = brandFromHost(h.get('x-tenant-host') ?? h.get('host'))
  return (
    <div className="logo-corner-root" style={{ position: 'absolute', top: 20, left: 20, zIndex: 5 }}>
      <Link href="/" aria-label={`${brand.name} home`} style={{ display: 'inline-block' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={brand.logo.markSrc}
          alt={brand.name}
          height={108}
          style={{ display: 'block', height: 108, width: 'auto' }}
        />
      </Link>
    </div>
  )
}
