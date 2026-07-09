import { requireSpaceAccess } from '@/lib/auth/context'
import { toResponse } from '@/lib/http'
import { authzDeps, getContextService } from '@/lib/wiring'

export const runtime = 'nodejs'

/** GET /api/spaces/:id/proposals — open + conflict PRs awaiting a human (reader+). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const { principal } = await requireSpaceAccess(req, id, 'reader', authzDeps)
    const proposals = await getContextService().listProposals(principal, id)
    return Response.json({ proposals })
  } catch (err) {
    return toResponse(err)
  }
}
