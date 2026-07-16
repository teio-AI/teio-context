import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { getEnv } from '@/lib/env'
import { fetchUserEmails } from '@/lib/invitations'
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

    // Actors are stored as stable Clerk user ids; resolve to email for display
    // (same as the Members/Tokens tabs). Best-effort — falls back to the id.
    const secretKey = getEnv().CLERK_SECRET_KEY
    const userIds = events.filter((e) => e.actor_type === 'user' && e.actor_id).map((e) => e.actor_id as string)
    const emails = secretKey && userIds.length ? await fetchUserEmails(userIds, secretKey) : {}
    const enriched = events.map((e) => ({
      ...e,
      actor_email: e.actor_type === 'user' && e.actor_id ? (emails[e.actor_id] ?? null) : null,
    }))

    return Response.json({ stats, events: enriched })
  } catch (err) {
    return toResponse(err)
  }
}
