import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Telegram is fully removed from the product (owner ruling 2026-10-10).
 * This guard fails if the word comes back anywhere in app code.
 *
 * Scanned: app/, lib/, hetzner-worker/. SQL migrations live in supabase/ and
 * are not scanned (history stays as-is; the leftover columns are dropped in
 * a later migration). No allowlist: every hit is a regression.
 */
const ROOT = join(__dirname, '..', '..')
const DIRS = ['app', 'lib', 'hetzner-worker']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage'])
const EXTS = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|md|sql|html)$/i
const ALLOWLIST = new Set<string>([])

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (EXTS.test(name)) out.push(full)
  }
}

describe('no Telegram anywhere in app code', () => {
  it('app/, lib/ and hetzner-worker/ never mention telegram', () => {
    const files: string[] = []
    for (const d of DIRS) walk(join(ROOT, d), files)
    expect(files.length).toBeGreaterThan(0)

    const hits: string[] = []
    for (const f of files) {
      const rel = relative(ROOT, f)
      if (ALLOWLIST.has(rel)) continue
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/telegram/i.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`)
      })
    }
    expect(hits).toEqual([])
  })
})
