// The site is built on a box that cannot read these variables (they are marked
// Sensitive on Vercel). Reading one as `process.env.NAME` would bake the build
// box's value into the bundle. They must go through runtimeEnv('NAME').

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runtimeEnv, SERVER_READ_PUBLIC_ENV } from '@/lib/runtime-env'

const ROOT = path.resolve(__dirname, '..')
const DIRS = ['app', 'lib', 'types']
const FILES = ['middleware.ts', 'instrumentation.ts']

function walk(dir: string, out: string[]): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('server-read public env', () => {
  it('is never read the baked-in way', () => {
    const files = DIRS.flatMap((d) => walk(path.join(ROOT, d), []))
    for (const f of FILES) {
      const full = path.join(ROOT, f)
      if (fs.existsSync(full)) files.push(full)
    }
    expect(files.length).toBeGreaterThan(100)

    const offenders: string[] = []
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const name of SERVER_READ_PUBLIC_ENV) {
          const baked = new RegExp(`process\\.env(\\.${name}\\b|\\[\\s*['"\`]${name}['"\`]\\s*\\])`)
          if (baked.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1} ${name}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('reads the value present when the code runs', () => {
    const name = 'RUNTIME_ENV_SPEC_VALUE'
    delete process.env[name]
    expect(runtimeEnv(name)).toBeUndefined()
    process.env[name] = ''
    expect(runtimeEnv(name)).toBeUndefined()
    process.env[name] = 'https://example.test'
    expect(runtimeEnv(name)).toBe('https://example.test')
    delete process.env[name]
  })
})
