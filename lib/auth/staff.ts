/**
 * The "real staff gate" on space creation (POST /api/spaces). Deliberately
 * simple for v1: an env-configured allowlist of Clerk user ids, no new
 * infrastructure. Parsing is separated from env access so this stays a pure,
 * easily testable function.
 */
export function parseStaffIds(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

export function isStaff(userId: string, staffIds: Set<string>): boolean {
  return staffIds.has(userId)
}
