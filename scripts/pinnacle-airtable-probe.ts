#!/usr/bin/env tsx
/**
 * Probe Brad Plummer's Pinnacle Airtable base from the CLI. Useful before
 * locking in PINNACLE_AIRTABLE_TABLES / PINNACLE_FIELD_MAP so we know what
 * tables and columns actually exist.
 *
 * Usage:
 *   PINNACLE_AIRTABLE_TOKEN=pat... \
 *   PINNACLE_AIRTABLE_BASE_ID=app... \
 *   tsx scripts/pinnacle-airtable-probe.ts
 *
 *   # or probe a single table by name:
 *   tsx scripts/pinnacle-airtable-probe.ts "Applications"
 */

const CANDIDATES = [
  'Applications', 'Apps', 'Submissions', 'Revenue', 'Sales',
  'Leads', 'Customers', 'Deals', 'Pipeline', 'Funded',
  'Approved', 'Funding', 'Clients',
]

async function previewTable(baseId: string, token: string, table: string) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?pageSize=3`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false as const, status: res.status, error: body.slice(0, 200) }
  }
  const json = (await res.json()) as { records: { id: string; fields: Record<string, unknown> }[] }
  const fields = new Set<string>()
  for (const r of json.records) for (const k of Object.keys(r.fields)) fields.add(k)
  return { ok: true as const, rows: json.records.length, fields: Array.from(fields).sort(), sample: json.records[0] }
}

async function main() {
  const token = process.env.PINNACLE_AIRTABLE_TOKEN
  const baseId = process.env.PINNACLE_AIRTABLE_BASE_ID
  if (!token || !baseId) {
    console.error('Set PINNACLE_AIRTABLE_TOKEN and PINNACLE_AIRTABLE_BASE_ID.')
    process.exit(1)
  }
  const arg = process.argv[2]
  const targets = arg ? [arg] : CANDIDATES
  for (const t of targets) {
    const r = await previewTable(baseId, token, t)
    if (r.ok) {
      console.log(`\n✓ ${t} — ${r.rows} row(s)`)
      console.log('  fields:', r.fields.join(', ') || '(empty)')
      if (r.sample) console.log('  sample:', JSON.stringify(r.sample.fields, null, 2).split('\n').map((l) => '    ' + l).join('\n'))
    } else {
      console.log(`✗ ${t} — HTTP ${r.status}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
