import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { authzDeps, getContextService } from '@/lib/wiring'

export const runtime = 'nodejs'

/**
 * GET /api/spaces/:id/context?path=… — the share-OUT read path. Returns
 * content + version (commit SHA) + blob (for the write path's CAS fast path,
 * Phase 3). Write/delete/move land on this same route in Phase 3.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const path = new URL(req.url).searchParams.get('path')
    if (!path) throw new ValidationError('query param "path" is required')

    const { principal } = await requireSpaceAccess(req, id, 'reader', authzDeps)
    const doc = await getContextService().getDocument(principal, id, path)

    await db
      .insertAudit({ spaceId: id, actorType: principal.type, actorId: principal.id, action: 'read', path, outcome: 'ok' })
      .catch(() => {})

    return Response.json(doc)
  } catch (err) {
    return toResponse(err)
  }
}
