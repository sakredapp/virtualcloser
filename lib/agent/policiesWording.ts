/**
 * The Revenue card counts "Policies written". Book reads count the same thing
 * internally as "applications", and Ciao repeated that word, so one answer said
 * applications where the card said policies (Ciao QA 2026-10-18). Every book
 * read passes through here on its way to the model: count keys and wording say
 * policies, names stay exactly as written.
 */

/** Values here are names someone typed (agent, agency, carrier, product); never reworded. */
const NAME_KEYS = new Set(['name', 'agency', 'team', 'label', 'carrier', 'product', 'producer', 'line'])

export function policiesKey(key: string, taken: (k: string) => boolean): string {
  if (!/applications/.test(key)) return key
  const next = key.replace(/applications/g, 'policies')
  // A row that already has a "policies" field keeps both, unambiguously.
  return taken(next) ? key.replace(/applications/g, 'policies_written') : next
}

export function policiesText(s: string): string {
  return s
    .replace(/\bApplications\b/g, 'Policies')
    .replace(/\bapplications\b/g, 'policies')
    .replace(/\bApplication\b/g, 'Policy')
    .replace(/\bapplication\b/g, 'policy')
    .replace(/\bApps\b/g, 'Policies')
    .replace(/\bapps\b/g, 'policies')
}

export function policiesWording<T>(v: T, key = ''): T {
  if (typeof v === 'string') return (NAME_KEYS.has(key) ? v : policiesText(v)) as T
  if (Array.isArray(v)) return v.map((x) => policiesWording(x, key)) as T
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(src)) {
      const nk = policiesKey(k, (c) => c !== k && Object.prototype.hasOwnProperty.call(src, c))
      out[nk] = policiesWording(val, k)
    }
    return out as T
  }
  return v
}
