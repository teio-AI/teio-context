import { z } from 'zod'
import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

const Body = z.object({ sha: z.string().min(1) })

/**
 * POST /api/spaces/:id/sync — a connector acks it has synced to `sha`; its
 * cursor becomes current. Only connector-bound machine tokens have a cursor
 * (ARCHITECTURE §2.2 sync_cursors are per-connector), so a Clerk user or a
 * bare token has nothing to ack.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))

    const { principal } = await requireSpaceAccess(req, id, 'reader', authzDeps)
    if (principal.type !== 'token') throw new ValidationError('sync ack requires a connector-bound machine token')

    const connectorId = await db.getConnectorIdForToken(principal.id)
    if (!connectorId) throw new ValidationError('this token is not bound to a connector; nothing to sync')

    await db.ackCursor(connectorId, parsed.data.sha)
    return Response.json({ status: 'synced', sha: parsed.data.sha })
  } catch (err) {
    return toResponse(err)
  }
}
