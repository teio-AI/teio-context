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

/**
 * Owner allowlist by EMAIL (STAFF_EMAILS) — lets you pre-authorize teammates
 * before they've ever signed in (no Clerk user id needed). Matched against a
 * user's *verified* emails on login. Case-insensitive.
 */
export function parseStaffEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isStaffEmail(verifiedEmails: string[], staffEmails: Set<string>): boolean {
  return verifiedEmails.some((e) => staffEmails.has(e.toLowerCase()))
}
