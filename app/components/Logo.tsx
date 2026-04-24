import Link from 'next/link'

type Props = {
  /** Square px size. Defaults to 40. */
  size?: number
  /** If true, renders with no link wrapper. */
  noLink?: boolean
  /** Override title / alt text. */
  alt?: string
  className?: string
  style?: React.CSSProperties
}

/**
 * Virtual Closer wordmark. Always square. Red tile with white italic serif.
 * Uses `/logo.svg` from /public so it scales crisply at any size.
 */
export function Logo({ size = 40, noLink, alt = 'Virtual Closer', className, style }: Props) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.svg"
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{
        display: 'block',
        borderRadius: Math.max(4, Math.round(size * 0.12)),
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
 * Tiny fixed mark for the top-left corner of every page.
 */
export function LogoCorner() {
  return (
    <div
      style={{
        position: 'fixed',
        top: 14,
        left: 14,
        zIndex: 50,
      }}
    >
      <Logo size={36} />
    </div>
  )
}
