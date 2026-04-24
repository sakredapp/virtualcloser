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
  /** 'wordmark' (default) = full VIRTUAL CLOSER tile. 'mark' = VC monogram — use for small sizes < 80px. */
  variant?: 'wordmark' | 'mark'
}

/**
 * Virtual Closer logo. Red tile with white italic serif.
 * Use `variant="mark"` for anything small (corner badges, nav chips).
 */
export function Logo({
  size = 40,
  noLink,
  alt = 'Virtual Closer',
  className,
  style,
  variant = 'wordmark',
}: Props) {
  const src = variant === 'mark' ? '/icon.svg' : '/logo.svg'
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{
        display: 'block',
        borderRadius: Math.max(6, Math.round(size * 0.18)),
        boxShadow: '0 4px 14px rgba(10, 10, 10, 0.22)',
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
 * Top-left brand badge: red tile + "VIRTUAL CLOSER" wordmark on a dark pill.
 * Big enough to actually read, links home.
 */
export function LogoCorner() {
  return (
    <Link
      href="/"
      aria-label="Virtual Closer home"
      style={{
        position: 'fixed',
        top: 18,
        left: 18,
        zIndex: 50,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.55rem',
        padding: '0.35rem 0.8rem 0.35rem 0.35rem',
        background: 'rgba(15, 15, 15, 0.82)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 999,
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.28)',
        textDecoration: 'none',
      }}
    >
      <Logo variant="mark" size={40} noLink style={{ boxShadow: 'none' }} />
      <span
        style={{
          color: '#ffffff',
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontStyle: 'italic',
          fontWeight: 600,
          fontSize: '0.95rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        Virtual <span style={{ opacity: 0.75 }}>Closer</span>
      </span>
    </Link>
  )
}
