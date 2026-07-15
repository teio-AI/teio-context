import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { NotFoundError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

/** DELETE /api/spaces/:id/tokens/:tid — revoke a service token (admin only). Immediate. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; tid: string }> }): Promise<Response> {
  try {
    const { id, tid } = await ctx.params
    const { principal } = await requireSpaceAccess(req, id, 'admin', authzDeps)

    if (!(await db.revokeToken(id, tid))) throw new NotFoundError('token not found or already revoked')

    await db.insertAudit({ spaceId: id, actorType: principal.type, actorId: principal.id, action: 'token_revoke', path: null, outcome: 'ok', requestId: getRequestId(req) })
    return Response.json({ status: 'revoked', id: tid })
  } catch (err) {
    return toResponse(err)
  }
}
