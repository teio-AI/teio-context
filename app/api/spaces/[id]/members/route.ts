import { z } from 'zod'
import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { getEnv } from '@/lib/env'
import { sendClerkInvitation } from '@/lib/invitations'
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
    const pending = hasRole(role, 'admin') ? await db.listPendingInvitations(id) : []
    return Response.json({ members, pending })
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

    const invite = await db.createPendingInvitation({ spaceId: id, email, role, invitedBy: principal.id })

    // Best-effort: Clerk sends the invite email. If it declines (e.g. the email
    // is already a registered user), that's fine — reconcile-on-login handles it.
    const secretKey = getEnv().CLERK_SECRET_KEY
    let emailed = false
    if (secretKey) {
      const origin = new URL(req.url).origin
      const sent = await sendClerkInvitation({ email, secretKey, redirectUrl: `${origin}/dashboard`, publicMetadata: { spaceId: id, role } })
      emailed = !!sent
      if (sent) await db.createPendingInvitation({ spaceId: id, email, role, invitedBy: principal.id, clerkInvitationId: sent.id })
    }

    await db.insertAudit({ spaceId: id, actorType: principal.type, actorId: principal.id, action: 'member_invite', outcome: 'ok', requestId: getRequestId(req) })
    return Response.json({ invited: email, role, emailed, invitationId: invite.id }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}
