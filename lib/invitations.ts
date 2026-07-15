/**
 * Send an invitation email via Clerk's Backend API. Best-effort: Clerk sends the
 * email (no email provider to configure). Returns the invitation id, or null if
 * Clerk declined (e.g. the email already belongs to a user — that's fine, the
 * pending_invitations row is the source of truth and reconcile-on-login will
 * pick it up next time they sign in).
 */
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
