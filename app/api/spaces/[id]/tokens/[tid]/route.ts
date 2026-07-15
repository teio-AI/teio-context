import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { hasRole } from '@/lib/auth/authorize'
import { NotFoundError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

/**
 * DELETE /api/spaces/:id/tokens/:tid — revoke a token. Admins can revoke any
 * token; a non-admin member can revoke a token they created (self-service, e.g.
 * a compromised one). 404 if unknown/already-revoked/not yours.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; tid: string }> }): Promise<Response> {
  try {
    const { id, tid } = await ctx.params
    const { principal, role } = await requireSpaceAccess(req, id, 'reader', authzDeps)

    const revoked = hasRole(role, 'admin')
      ? await db.revokeToken(id, tid)
      : await db.revokeOwnToken(id, tid, principal.id)
    if (!revoked) throw new NotFoundError('token not found, already revoked, or not yours to revoke')

    await db.insertAudit({ spaceId: id, actorType: principal.type, actorId: principal.id, action: 'token_revoke', path: null, outcome: 'ok', requestId: getRequestId(req) })
    return Response.json({ status: 'revoked', id: tid })
  } catch (err) {
    return toResponse(err)
  }
}
