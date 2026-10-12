import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The public demo and marketing pages (app/cxo/**) are sales material open to
 * anyone. Owner rule: never a real client's name, people or figures there.
 * The demo company is invented ("Northgate Group", northgate.example).
 */

const ROOT = join(__dirname, '..', '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('public demo carries no real client', () => {
  const publicFiles = walk(join(ROOT, 'app', 'cxo')).filter((p) => /\.(tsx?|css)$/.test(p))

  it('app/cxo/** never names the client, its domain or its people', () => {
    expect(publicFiles.length).toBeGreaterThan(5)
    for (const file of publicFiles) {
      // Shared prop keys and the lib folder are internal identifiers, not copy.
      const text = readFileSync(file, 'utf8')
        .replace(/@\/lib\/pinnacle\//g, '')
        .replace(/\bisPinnacle\b/g, '')
        .replace(/\bpinnacleRows\b/g, '')
      expect(text, file).not.toMatch(/pinnacle/i)
      expect(text, file).not.toMatch(/cavaleri/i)
      expect(text, file).not.toMatch(/@gmail\.com/i)
    }
  })

  it('every email on the demo is on a reserved example domain', () => {
    for (const file of publicFiles.filter((p) => p.includes(join('cxo', 'demo')))) {
      const emails = readFileSync(file, 'utf8').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []
      for (const e of emails) expect(e, file).toMatch(/(\.example|@example\.com)$/)
    }
  })

  it('the demo-only data in shared libs is invented too', () => {
    for (const rel of ['lib/cxoAdoptionShared.ts', 'lib/mira/dailyQueueShared.ts']) {
      const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, rel).not.toMatch(/pinnacle|cavaleri/i)
    }
  })

  it('shared client components take the organisation name from the page, never hardcode it', () => {
    for (const rel of ['app/components/cxo/ExecOverview.tsx', 'app/components/cxo/TeamPeople.tsx', 'app/components/cxo/PartnersBoard.tsx']) {
      // Comments never ship; identifiers (isPinnacle, pinnacleRows, /api/pinnacle) are not copy.
      const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, rel).not.toMatch(/\bPinnacle\b/)
    }
  })

  it('the demo page is titled Suite CXO', () => {
    const page = read('app/cxo/demo/page.tsx')
    expect(page).toContain("'Suite CXO — Live Demo'")
    expect(page).not.toMatch(/CXO Suite(?!\.png)/)
  })
})
