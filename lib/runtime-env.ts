// Read an environment variable when the code RUNS, never when it is built.
//
// Next.js replaces `process.env.NEXT_PUBLIC_X` with the literal value at build
// time, in server code too. The site is built on our own build box, which
// cannot read variables marked Sensitive on Vercel, so a public-prefixed name
// read the usual way would be baked in as whatever the build box had (nothing,
// or a placeholder) instead of the real value.
//
// Vercel gives every function the real value of every variable at runtime, so
// server code reads these names through here. The name is passed as a string,
// which the build cannot replace.
//
// Server only. In the browser there is no runtime environment: a value the
// browser needs must be handed down from a server component as a prop.
//
// The names listed in SERVER_READ_PUBLIC_ENV must match the repository
// variable PREBUILT_SERVER_READ_PUBLIC_ENV (see .github/workflows/
// vercel-prebuilt.yml); __tests__/runtimeEnv.spec.ts keeps source code from
// reading them the baked-in way.

export const SERVER_READ_PUBLIC_ENV = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_BASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
] as const

export function runtimeEnv(name: string): string | undefined {
  const env = process.env as Record<string, string | undefined>
  const value = env[name]
  return value === '' ? undefined : value
}
