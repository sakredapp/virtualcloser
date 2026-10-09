/**
 * Tenant hosts that were renamed. The old subdomain keeps working: the
 * middleware sends page loads to the new one. Pinnacle Life Group's main
 * address is pinnacle.suitecxo.com (owner 10-09); spence.* was the original.
 * Edge-safe (imported by middleware): no Node or database imports here.
 */
export const HOST_RENAMES: Readonly<Record<string, string>> = {
  spence: 'pinnacle',
}

/** The host to send someone to: the renamed host when there is one. */
export function canonicalHost(slug: string): string {
  const s = slug.trim().toLowerCase()
  return HOST_RENAMES[s] ?? s
}
