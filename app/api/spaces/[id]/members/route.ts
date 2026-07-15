import { z } from 'zod'
import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { getEnv } from '@/lib/env'
import { fetchUserEmails, revokeClerkInvitation, sendClerkInvitation } from '@/lib/invitations'
import { ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { hasRole } from '@/lib/auth/authorize'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

const InviteBody = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'reader']),
})

/**
 * GET /api/spaces/:id/members — the member roster (any member). Admins also get
 * the list of pending email invitations (not yet accepted).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const { role } = await requireSpaceAccess(req, id, 'reader', authzDeps)
    const members = await db.listMembers(id)

    // Resolve emails for display (we store the stable Clerk id; email is nicer).
    const secretKey = getEnv().CLERK_SECRET_KEY
    const emails = secretKey
      ? await fetchUserEmails(members.filter((m) => m.principal_type === 'user').map((m) => m.principal_id), secretKey)
      : {}
    const enriched = members.map((m) => ({ ...m, email: emails[m.principal_id] ?? null }))

    const pending = hasRole(role, 'admin') ? await db.listPendingInvitations(id) : []
    return Response.json({ members: enriched, pending })
  } catch (err) {
    return toResponse(err)
  }
}

/**
 * POST /api/spaces/:id/members — invite someone by EMAIL (admin). Records a
 * pending invitation and sends a Clerk invite email. When they sign up/in, the
 * membership is materialized by reconciling their verified email (see /api/me).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const { principal } = await requireSpaceAccess(req, id, 'admin', authzDeps)

    const parsed = InviteBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))
    const { email, role } = parsed.data

    const secretKey = getEnv().CLERK_SECRET_KEY

    // Re-inviting the same email? Revoke the old Clerk invitation first, else
    // Clerk refuses the duplicate and no new email is sent.
    if (secretKey) {
      const existing = await db.getPendingInvitation(id, email)
      if (existing?.clerk_invitation_id) await revokeClerkInvitation(existing.clerk_invitation_id, secretKey)
    }

    // Best-effort: Clerk sends the invite email. If it declines (e.g. the email
    // already belongs to a user), that's fine — reconcile-on-login still adds
    // them the next time they sign in with that verified email.
    let clerkInvitationId: string | null = null
    if (secretKey) {
      const origin = new URL(req.url).origin
      // MUST point at the sign-up page: Clerk appends the invitation ticket
      // (__clerk_ticket) to this URL, and <SignUp> consumes it to create the
      // account. Sending them to /dashboard drops the ticket → no account.
      const sent = await sendClerkInvitation({ email, secretKey, redirectUrl: `${origin}/sign-up`, publicMetadata: { spaceId: id, role } })
      clerkInvitationId = sent?.id ?? null
    }

    const invite = await db.createPendingInvitation({ spaceId: id, email, role, invitedBy: principal.id, clerkInvitationId })

    await db.insertAudit({ spaceId: id, actorType: principal.type, actorId: principal.id, action: 'member_invite', outcome: 'ok', requestId: getRequestId(req) })
    return Response.json({ invited: email, role, emailed: !!clerkInvitationId, invitationId: invite.id }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}
