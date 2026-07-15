/**
 * Send an invitation email via Clerk's Backend API. Best-effort: Clerk sends the
 * email (no email provider to configure). Returns the invitation id, or null if
 * Clerk declined (e.g. the email already belongs to a user — that's fine, the
 * pending_invitations row is the source of truth and reconcile-on-login will
 * pick it up next time they sign in).
 */
/**
 * Resolve Clerk user ids → primary email, batched in one Backend API call.
 * Best-effort: returns {} on any failure (UI falls back to showing the id).
 * We store the stable Clerk id on memberships; email is display-only.
 */
export async function fetchUserEmails(
  userIds: string[],
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string>> {
  const ids = [...new Set(userIds)].filter(Boolean)
  if (ids.length === 0) return {}
  try {
    const params = new URLSearchParams()
    for (const id of ids) params.append('user_id', id)
    params.set('limit', String(Math.min(ids.length, 100)))
    const res = await fetchImpl(`https://api.clerk.com/v1/users?${params.toString()}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    if (!res.ok) return {}
    const users = (await res.json()) as {
      id: string
      primary_email_address_id?: string
      email_addresses?: { id: string; email_address: string }[]
    }[]
    const map: Record<string, string> = {}
    for (const u of users) {
      const primary = u.email_addresses?.find((e) => e.id === u.primary_email_address_id) ?? u.email_addresses?.[0]
      if (primary) map[u.id] = primary.email_address
    }
    return map
  } catch {
    return {}
  }
}

export async function sendClerkInvitation(opts: {
  email: string
  redirectUrl: string
  secretKey: string
  publicMetadata?: Record<string, unknown>
  fetchImpl?: typeof fetch
}): Promise<{ id: string } | null> {
  const fetchImpl = opts.fetchImpl ?? fetch
  try {
    const res = await fetchImpl('https://api.clerk.com/v1/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_address: opts.email,
        redirect_url: opts.redirectUrl,
        public_metadata: opts.publicMetadata ?? {},
        notify: true,
      }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { id: string }
    return { id: json.id }
  } catch {
    return null
  }
}
