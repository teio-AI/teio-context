import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { getEnv } from '@/lib/env'
import { revokeClerkInvitation } from '@/lib/invitations'
import { NotFoundError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

/** Cancel a pending email invitation (admin). Also revokes the Clerk invitation. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; inviteId: string }> }): Promise<Response> {
  try {
    const { id, inviteId } = await ctx.params
    const { principal } = await requireSpaceAccess(req, id, 'admin', authzDeps)

    const cancelled = await db.cancelPendingInvitation(id, inviteId)
    if (!cancelled) throw new NotFoundError('invitation not found on this space')

    const secretKey = getEnv().CLERK_SECRET_KEY
    if (secretKey && cancelled.clerk_invitation_id) await revokeClerkInvitation(cancelled.clerk_invitation_id, secretKey)

    await db.insertAudit({
      spaceId: id,
      actorType: principal.type,
      actorId: principal.id,
      action: 'invite_cancel',
      outcome: 'ok',
      requestId: getRequestId(req),
    })
    return new Response(null, { status: 204 })
  } catch (err) {
    return toResponse(err)
  }
}
