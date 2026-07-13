import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { authzDeps, getContextService } from '@/lib/wiring'

export const runtime = 'nodejs'

/**
 * GET /api/spaces/:id/search?q=… — Postgres FTS over the derived `documents`
 * index (tsvector + snippet, ARCHITECTURE §7.3). Results carry path + snippet
 * only; fetch full content via GET /context?path=… on a hit.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const q = new URL(req.url).searchParams.get('q')
    if (!q) throw new ValidationError('query param "q" is required')

    const { principal } = await requireSpaceAccess(req, id, 'reader', authzDeps)
    const results = await getContextService().search(principal, id, q)

    await db
      .insertAudit({ spaceId: id, actorType: principal.type, actorId: principal.id, action: 'read', path: null, outcome: 'ok', requestId: getRequestId(req) })
      .catch(() => {})

    return Response.json({ results })
  } catch (err) {
    return toResponse(err)
  }
}
