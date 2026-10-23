/**
 * The seat count from a self-hosted box's licence (selfhost/licence/). The boot
 * gate (selfhost/licence/check.mjs) verifies the signed licence file and starts
 * the app with LICENCE_SEATS set; nothing here re-reads the file or calls out.
 * Returns null in the cloud (no SELFHOST=1), where seats come from billing.
 */
export function licenceSeatCap(env: NodeJS.ProcessEnv = process.env): number | null {
  if (env.SELFHOST !== '1') return null
  const n = parseInt(env.LICENCE_SEATS?.trim() || '', 10)
  return Number.isInteger(n) && n > 0 ? n : null
}
