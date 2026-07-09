import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { NotFoundError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

/** DELETE /api/spaces/:id/tokens/:tid — revoke a machine token (owner). Idempotent-ish: revoking an already-revoked/unknown token 404s. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; tid: string }> }): Promise<Response> {
  try {
    const { id, tid } = await ctx.params
    const { principal } = await requireSpaceAccess(req, id, 'owner', authzDeps)

    const revoked = await db.revokeToken(id, tid)
    if (!revoked) throw new NotFoundError('token not found or already revoked')

    await db.insertAudit({ spaceId: id, actorType: principal.type, actorId: principal.id, action: 'token_revoke', path: null, outcome: 'ok' })
    return Response.json({ status: 'revoked', id: tid })
  } catch (err) {
    return toResponse(err)
  }
}
