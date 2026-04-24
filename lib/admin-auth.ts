import { cookies } from 'next/headers'

const COOKIE_NAME = 'vc_admin'

export async function isAdminAuthed(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  const expected = process.env.ADMIN_PASSWORD
  return Boolean(expected && token && token === expected)
}

export async function setAdminCookie(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected || password !== expected) return false
  const jar = await cookies()
  jar.set(COOKIE_NAME, password, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  return true
}

export async function clearAdminCookie() {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}
