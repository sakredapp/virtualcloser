import { redirect } from 'next/navigation'
import { setAdminCookie } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export default function AdminLoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>
}) {
  async function login(formData: FormData) {
    'use server'
    const password = String(formData.get('password') ?? '')
    const ok = await setAdminCookie(password)
    if (!ok) redirect('/admin/login?error=1')
    redirect('/admin/clients')
  }

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <div className="card" style={{ marginTop: '15vh' }}>
        <p className="eyebrow">Virtual Closer · Admin</p>
        <h1 style={{ fontSize: '1.6rem', margin: '0.3rem 0 1rem' }}>Sign in</h1>
        <form action={login}>
          <input
            name="password"
            type="password"
            required
            autoFocus
            placeholder="Admin password"
            style={inputStyle}
          />
          <button type="submit" className="btn approve" style={{ marginTop: '0.7rem', width: '100%' }}>
            Continue
          </button>
        </form>
      </div>
    </main>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.7rem',
  borderRadius: 10,
  border: '1px solid var(--border-soft)',
  background: '#ffffff',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
}
