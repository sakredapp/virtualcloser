#!/usr/bin/env tsx
/**
 * One-off seed: turn the two Career Navigator PDFs into Projects for Spencer's
 * CXO tenant (rep_spence), using the real production pipeline
 * (extractDocText → generateProjectPlan → createProjectFromPlan). Proves the
 * Projects feature end-to-end and gives Spencer two example projects to open.
 *
 * Usage:
 *   tsx scripts/seed-projects.ts
 *
 * Reads keys from .env.local (ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY). Idempotent-ish: re-running creates duplicates,
 * so only run once.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ── Load .env.local into process.env BEFORE importing any lib that reads it ──
function loadEnv(file: string) {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env) || !process.env[key]) process.env[key] = val
  }
}
loadEnv(join(process.cwd(), '.env.local'))
loadEnv(join(process.cwd(), '.env'))

const REP_ID = 'rep_spence'
const OWNER_MEMBER_ID = '418d39ec-9846-4596-acd1-b59e28f63266' // Spencer (owner)
const DOWNLOADS = join(homedir(), 'Downloads')

const DOCS = [
  { file: 'Career_Navigator_The_Recipe.docx.pdf', title: 'Career Navigator — The Recipe (Launch Playbook)' },
  { file: 'Career_Navigator_Launch_Plan.docx.pdf', title: 'Career Navigator — Second Runway Launch Plan' },
]

async function main() {
  const { extractDocText } = await import('../lib/extractText')
  const { generateProjectPlan } = await import('../lib/claude')
  const { createProjectFromPlan } = await import('../lib/projects')
  const { runWithClaudeKey } = await import('../lib/anthropic')
  const { supabase } = await import('../lib/supabase')

  // Use Spencer's own tenant Anthropic key (BYOK) — same key the live app
  // threads through getAnthropic() for his requests.
  const { data: repRow } = await supabase.from('reps').select('claude_api_key').eq('id', REP_ID).maybeSingle()
  const tenantKey = (repRow as { claude_api_key?: string } | null)?.claude_api_key ?? null
  if (!tenantKey) throw new Error('rep_spence has no claude_api_key')

  for (const doc of DOCS) {
    const path = join(DOWNLOADS, doc.file)
    console.log(`\n📄 ${doc.file}`)
    const buffer = readFileSync(path)
    const { text, kind } = await extractDocText({ filename: doc.file, buffer })
    console.log(`   extracted ${text.length} chars (${kind})`)

    const plan = await runWithClaudeKey(tenantKey, () =>
      generateProjectPlan(text, { repName: 'Spencer', titleHint: doc.title }),
    )
    const taskCount = plan.sections.reduce((n, s) => n + s.tasks.length, 0)
    const stepCount = plan.sections.reduce((n, s) => n + s.tasks.reduce((m, t) => m + t.steps.length, 0), 0)
    console.log(`   plan: "${plan.name}" — ${plan.sections.length} sections, ${taskCount} tasks, ${stepCount} steps`)

    const projectId = await createProjectFromPlan({
      repId: REP_ID,
      ownerMemberId: OWNER_MEMBER_ID,
      plan,
      sourceKind: kind === 'pdf' ? 'pdf' : kind === 'docx' ? 'docx' : 'prompt',
      sourceText: text.slice(0, 50_000),
    })
    console.log(`   ✅ created project ${projectId}`)
  }
  console.log('\nDone.')
}

main().catch((err) => {
  console.error('SEED FAILED:', err)
  process.exit(1)
})
