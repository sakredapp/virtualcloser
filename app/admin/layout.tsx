import AdminNav from './AdminNav'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Suppress the marketing site logo/nav that the root layout injects */}
      <div data-admin-shell hidden aria-hidden />
      <AdminNav />
      {children}
    </>
  )
}
