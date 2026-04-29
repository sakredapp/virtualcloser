import Link from 'next/link'

type Props = {
  /** Rendered height in px. Width is derived from the 2:1 aspect ratio. */
  size?: number
  noLink?: boolean
  alt?: string
  className?: string
  style?: React.CSSProperties
}

// Wordmark is 2000×1000 (2:1). Height-driven sizing keeps it from getting squashed.
const LOGO_SRC =
  'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/Virtual%20(2000%20x%201000%20px).png'
const LOGO_RATIO = 2

// Square mark (1024×1024).
const OVAL_LOGO_SRC =
  'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/circle/oval%20logo/oval%20log.png'

/**
 * Virtual Closer wordmark. `size` = height in px; width follows the 2:1 ratio.
 */
export function Logo({ size = 56, noLink, alt = 'Virtual Closer', className, style }: Props) {
  const height = size
  const width = Math.round(size * LOGO_RATIO)
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt={alt}
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
    <Link href="/" aria-label="Virtual Closer home" style={{ display: 'inline-block' }}>
      {img}
    </Link>
  )
}

/**
 * Top-left corner mark: sits at the top of the page, scrolls away with content.
 * Uses the oval/circle mark on app pages; falls back to the wordmark elsewhere.
 */
export function LogoCorner() {
  return (
    <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 5 }}>
      <Link href="/" aria-label="Virtual Closer home" style={{ display: 'inline-block' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={OVAL_LOGO_SRC}
          alt="Virtual Closer"
          height={72}
          style={{ display: 'block', height: 72, width: 'auto' }}
        />
      </Link>
    </div>
  )
}
