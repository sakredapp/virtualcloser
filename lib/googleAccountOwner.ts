/**
 * Who may disconnect a connected Google account (owner 10-09).
 *
 * Only the person who owns the connection. A row saved under a member_id
 * belongs to that member. The tenant-level row (member_id null) is where the
 * workspace OWNER's own connection is stored (see the OAuth callback), so it
 * belongs to the member whose role is 'owner'. Admin rights do not extend to
 * someone else's calendar: an admin can see the shared calendar, never
 * disconnect it.
 */
export function ownsGoogleAccount(
  account: { memberId: string | null },
  viewer: { id: string; role?: string | null } | null | undefined,
): boolean {
  if (!viewer) return false
  if (account.memberId) return account.memberId === viewer.id
  return viewer.role === 'owner'
}
