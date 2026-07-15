import { auth } from '@clerk/nextjs/server'
import * as db from '@/db'
import { NotFoundError, UnauthorizedError } from '@/lib/errors'
import { toResponse } from '@/lib/http'

export const runtime = 'nodejs'

/** DELETE /api/me/tokens/:tid — revoke one of your own personal tokens. Immediate. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ tid: string }> }): Promise<Response> {
  try {
    const { userId } = await auth()
    if (!userId) throw new UnauthorizedError('sign in required')
    const { tid } = await ctx.params
    if (!(await db.revokePersonalToken(userId, tid))) throw new NotFoundError('token not found or already revoked')
    return new Response(null, { status: 204 })
  } catch (err) {
    return toResponse(err)
  }
}
