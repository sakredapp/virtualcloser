/**
 * Dashboard route layout — drops a sentinel `[data-app-shell]` element so
 * globals.css can scope app-only styling (paper background, lighter cards)
 * via `body:has([data-app-shell])`. The hero block stays red as the page
 * anchor; everything around it sits on warm-paper to match the demo aesthetic.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div data-app-shell hidden aria-hidden />
      {children}
    </>
  )
}
