import Link from 'next/link'

type Props = {
  size?: number
  noLink?: boolean
  alt?: string
  className?: string
  style?: React.CSSProperties
}

/**
 * Virtual Closer logo. Uses the actual PNG from /public/logo.png.
 */
export function Logo({ size = 56, noLink, alt = 'Virtual Closer', className, style }: Props) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{
        display: 'block',
        borderRadius: Math.max(6, Math.round(size * 0.14)),
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
 * Top-left corner mark: the real logo, big enough to read.
 */
export function LogoCorner() {
  return (
    <div style={{ position: 'fixed', top: 14, left: 14, zIndex: 50 }}>
      <Logo size={112} />
    </div>
  )
}
