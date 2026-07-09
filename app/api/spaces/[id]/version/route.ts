import { requireSpaceAccess } from '@/lib/auth/context'
import { toResponse } from '@/lib/http'
import { authzDeps, getContextService } from '@/lib/wiring'

export const runtime = 'nodejs'

/** GET /api/spaces/:id/version — the current branch HEAD SHA (staleness check). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const { principal } = await requireSpaceAccess(req, id, 'reader', authzDeps)
    const version = await getContextService().getVersion(principal, id)
    return Response.json(version)
  } catch (err) {
    return toResponse(err)
  }
}
