import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Guards for the self-hosted box package (selfhost/). These keep the package
// installable as the repo changes: every migration has a place in the boot
// order, no secret value is committed, and the box publishes nothing by accident.
const root = path.resolve(__dirname, '..')
const sh = (p: string) => fs.readFileSync(path.join(root, 'selfhost', p), 'utf8')

describe('selfhost package', () => {
  it('lists every supabase/*.sql in the migration order, schema.sql first', () => {
    const listed = sh('db/migrations.txt')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
    const files = fs.readdirSync(path.join(root, 'supabase')).filter((f) => f.endsWith('.sql'))
    expect(listed[0]).toBe('schema.sql')
    const missing = files.filter((f) => !listed.includes(f))
    // A new migration must be appended to selfhost/db/migrations.txt.
    expect(missing).toEqual([])
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('commits no secret values in .env.example', () => {
    const secretKeys = [
      'POSTGRES_PASSWORD', 'PGRST_AUTHENTICATOR_PASSWORD', 'JWT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY',
      'SESSION_SECRET', 'CRON_SECRET', 'RESTIC_PASSWORD', 'ADMIN_PASSWORD_HASH', 'LLM_API_KEY',
      'TS_AUTHKEY', 'HEALTH_REPORT_TOKEN', 'GOOGLE_CLIENT_SECRET', 'SMTP_PASS',
      'RESTIC_S3_SECRET_ACCESS_KEY',
    ]
    const env = sh('.env.example')
    for (const k of secretKeys) {
      const line = env.split('\n').find((l) => l.startsWith(`${k}=`))
      expect(line, k).toBeDefined()
      const value = line!.slice(k.length + 1).replace(/\s+#.*$/, '').trim()
      expect(value, k).toBe('')
    }
  })

  it('publishes only Caddy (on BIND_ADDR) and the health agent (on loopback)', () => {
    const compose = sh('docker-compose.yml')
    const published = [...compose.matchAll(/^\s+- "([^"]+:\d+)"$/gm)].map((m) => m[1])
    expect(published.length).toBeGreaterThan(0)
    for (const p of published) {
      expect(p.startsWith('${BIND_ADDR:-127.0.0.1}:') || p.startsWith('127.0.0.1:'), p).toBe(true)
    }
  })

  it('gives every always-on service a memory limit', () => {
    const compose = sh('docker-compose.yml')
    const services = compose.split(/^services:\n/m)[1].split(/^volumes:/m)[0]
    const blocks = services.split(/^ {2}(?=[a-z])/m).filter(Boolean)
    for (const b of blocks) {
      const name = b.split(':')[0]
      if (/profiles:/.test(b)) continue // opt-in (ollama on a GPU box, tailscale)
      expect(b, name).toMatch(/memory: \d+[mg]/)
    }
  })
})
