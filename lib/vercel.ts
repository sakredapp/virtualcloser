// Thin Vercel REST API client — used to auto-add tenant subdomains to the
// project so the admin doesn't have to click around in the Vercel dashboard.
//
// Required env:
//   VERCEL_API_TOKEN     – personal/team token with project access
//   VERCEL_PROJECT_ID    – the virtualcloser project id (prj_…)
//   VERCEL_TEAM_ID       – optional, only if the project is in a team
//
// All functions are best-effort: on any failure they return { ok: false, error }
// without throwing, so client creation never blocks on Vercel.

type Result = { ok: true; alreadyExists?: boolean } | { ok: false; error: string }

export function vercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID)
}

function withTeam(path: string): string {
  const team = process.env.VERCEL_TEAM_ID
  if (!team) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}teamId=${encodeURIComponent(team)}`
}

export async function addProjectDomain(domain: string): Promise<Result> {
  if (!vercelConfigured()) {
    return { ok: false, error: 'vercel not configured' }
  }
  const project = process.env.VERCEL_PROJECT_ID!
  const url = `https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/domains`

  try {
    const res = await fetch(withTeam(url), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    })
    if (res.ok) return { ok: true }
    const body = await res.json().catch(() => ({}))
    // 409 = already added (maybe to this project, maybe another). Treat as success.
    if (res.status === 409 || body?.error?.code === 'domain_already_in_use') {
      return { ok: true, alreadyExists: true }
    }
    return {
      ok: false,
      error: body?.error?.message ?? `vercel ${res.status}`,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function rootDomain(): string {
  return (process.env.ROOT_DOMAIN ?? 'virtualcloser.com').replace(/^https?:\/\//, '').replace(/\/$/, '')
}
