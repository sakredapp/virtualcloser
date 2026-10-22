/**
 * Finds every place a user can change something, so the registry spec can
 * prove each one is registered (lib/settings/registryShared REGISTRY) or
 * exempt with a reason (REGISTRY_EXEMPT). Sources look like:
 *   'POST /api/me/about'                                     mutating API route
 *   'action:dashboard/settings/page.tsx#actionInviteAssistant' server action
 *   'field:dashboard/settings/ExecAssistantSection.tsx#email'  form field on a settings page
 * Paths are relative to the app/ folder, always with forward slashes.
 */
import fs from 'node:fs'
import path from 'node:path'

const rel = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/')

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) {
      if (d.name === 'node_modules' || d.name.startsWith('.')) continue
      walk(p, out)
    } else out.push(p)
  }
  return out
}

const ROUTE_METHOD_RE = /export\s+(?:async\s+function|const)\s+(POST|PUT|PATCH|DELETE)\b/g
const INLINE_ACTION_RE = /(?:async\s+function\s+(\w+)\s*\([^)]*\)[^{]*|const\s+(\w+)\s*=\s*async\s*\([^)]*\)[^=]*=>\s*)\{\s*['"]use server['"]/g
const EXPORTED_FN_RE = /export\s+async\s+function\s+(\w+)/g
const FIELD_RE = /\bname=["'{]+([a-zA-Z_][\w]*)["'}]+/g

/** Mutating API routes under <appDir>/api. */
export function discoverRoutes(appDir: string): string[] {
  const out = new Set<string>()
  for (const f of walk(path.join(appDir, 'api'))) {
    if (!/route\.tsx?$/.test(f)) continue
    const src = fs.readFileSync(f, 'utf8')
    const url = '/' + rel(appDir, path.dirname(f))
    for (const m of src.matchAll(ROUTE_METHOD_RE)) out.add(`${m[1]} ${url}`)
  }
  return [...out].sort()
}

/** Server actions: whole 'use server' files (each exported function) and inline 'use server' functions. */
export function discoverActions(appDir: string): string[] {
  const out = new Set<string>()
  for (const f of walk(appDir)) {
    if (!/\.tsx?$/.test(f) || rel(appDir, f).startsWith('api/')) continue
    const src = fs.readFileSync(f, 'utf8')
    if (!src.includes('use server')) continue
    const file = rel(appDir, f)
    if (/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/.test(src)) {
      for (const m of src.matchAll(EXPORTED_FN_RE)) out.add(`action:${file}#${m[1]}`)
    }
    for (const m of src.matchAll(INLINE_ACTION_RE)) out.add(`action:${file}#${m[1] ?? m[2]}`)
  }
  return [...out].sort()
}

/** Named form fields on the settings and integrations pages. */
export function discoverFields(appDir: string, dirs = ['dashboard/settings', 'dashboard/integrations']): string[] {
  const out = new Set<string>()
  for (const d of dirs) {
    for (const f of walk(path.join(appDir, d))) {
      if (!/\.tsx$/.test(f)) continue
      const src = fs.readFileSync(f, 'utf8')
      for (const m of src.matchAll(FIELD_RE)) out.add(`field:${rel(appDir, f)}#${m[1]}`)
    }
  }
  return [...out].sort()
}

export function discoverAll(appDir: string): string[] {
  return [...discoverRoutes(appDir), ...discoverActions(appDir), ...discoverFields(appDir)]
}
