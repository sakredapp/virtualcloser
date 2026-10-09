/** Minimal .env.local loader (no dotenv dependency). Never overrides vars already set. */
import fs from 'node:fs'
import path from 'node:path'

export function loadEnv(root: string): string[] {
  const loaded: string[] = []
  for (const name of ['.env.local', '.env']) {
    const p = path.join(root, name)
    if (!fs.existsSync(p)) continue
    for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (process.env[key] === undefined && val !== '') {
        process.env[key] = val
        loaded.push(key)
      }
    }
    break
  }
  return loaded
}

export function repoRoot(): string {
  // scripts/mira-exec-eval/lib → repo root
  return path.resolve(__dirname, '..', '..', '..')
}
