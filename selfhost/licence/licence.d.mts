// Types for licence.mjs (plain JS so the box runs it without a build step).
export type LicencePayload = {
  v: 1
  client_id: string
  client_name: string
  box_id: string
  seats: number
  issued_at: string
  expires_at: string
}
export type LicenceCheck =
  | { ok: true; licence: LicencePayload; daysLeft: number; reason?: undefined; expired?: undefined }
  | { ok: false; reason: string; licence?: LicencePayload; expired?: boolean }
export const PREFIX: string
export const PUBLIC_KEY_PEM: string
export function payloadError(p: unknown): string | null
export function signLicence(payload: LicencePayload, privateKeyPem: string): string
export function expiresAtMs(p: Pick<LicencePayload, 'expires_at'>): number
export function verifyLicence(
  text: string | null | undefined,
  opts?: { boxId?: string; now?: number; publicKeyPem?: string },
): LicenceCheck
