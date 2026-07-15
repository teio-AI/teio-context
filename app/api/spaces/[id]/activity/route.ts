import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { toResponse } from '@/lib/http'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

/**
 * GET /api/spaces/:id/activity — per-project stats (current version, last
 * updated, writes in the last 7 days, doc count, open proposals) plus the recent
 * audit feed. Any member can view. Powers the dashboard Overview + History.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    await requireSpaceAccess(req, id, 'reader', authzDeps)
    const [stats, events] = await Promise.all([db.getActivityStats(id), db.listRecentAudit(id, 50)])
    return Response.json({ stats, events })
  } catch (err) {
    return toResponse(err)
  }
}
