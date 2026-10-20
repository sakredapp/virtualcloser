/**
 * The operator console's label, by host. On a Suite CXO host the admin
 * sign-in says "Suite CXO · Admin", never "Virtual Closer · Admin"
 * (owner 2026-10-20). Virtual Closer hosts are unchanged.
 */
import { brandFromHost } from '@/lib/brand'

export function adminEyebrow(host: string | null | undefined): string {
  return `${brandFromHost(host).name} · Admin`
}
