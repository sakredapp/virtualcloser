/**
 * Brain dump route layout — see comment on /dashboard/layout.tsx.
 * Same `[data-app-shell]` marker so the brain dump page picks up the
 * paper background + lighter card styling that the rest of the app uses.
 */
import AppTopbar from '@/app/components/AppTopbar'

export default function BrainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div data-app-shell hidden aria-hidden />
      <AppTopbar />
      {children}
    </>
  )
}
