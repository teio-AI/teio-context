import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { NotFoundError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

/** Remove a member from a space. Owner only. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; mid: string }> }): Promise<Response> {
  try {
    const { id, mid } = await ctx.params
    const { principal } = await requireSpaceAccess(req, id, 'owner', authzDeps)

    const removed = await db.removeMember(id, mid)
    if (!removed) throw new NotFoundError('member not found on this space')

    await db.insertAudit({
      spaceId: id,
      actorType: principal.type,
      actorId: principal.id,
      action: 'member_remove',
      outcome: 'ok',
      requestId: getRequestId(req),
    })
    return new Response(null, { status: 204 })
  } catch (err) {
    return toResponse(err)
  }
}
