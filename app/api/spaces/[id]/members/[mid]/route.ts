import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { isGlobalOwner } from '@/lib/wiring'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

/** Remove a member from a space (admin). Can't remove a global Owner or the last admin. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; mid: string }> }): Promise<Response> {
  try {
    const { id, mid } = await ctx.params
    const { principal } = await requireSpaceAccess(req, id, 'admin', authzDeps)

    const member = await db.getSpaceMember(id, mid)
    if (!member) throw new NotFoundError('member not found on this space')
    // A global Owner always has access anyway; don't let them be removed here.
    if (member.principal_id && isGlobalOwner(member.principal_id)) {
      throw new ValidationError('cannot remove a global Owner')
    }
    // Never orphan a project: keep at least one admin.
    if (member.role === 'admin' && (await db.countSpaceAdmins(id)) <= 1) {
      throw new ValidationError('cannot remove the last admin — promote another member to admin first')
    }

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
