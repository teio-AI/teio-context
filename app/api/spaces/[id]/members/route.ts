import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import * as db from '@/db'
import { authorizeSpace } from '@/lib/auth/authorize'
import { requireSpaceAccess } from '@/lib/auth/context'
import { UnauthorizedError, ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

const Body = z.object({
  principalType: z.enum(['user', 'token']),
  principalId: z.string().min(1),
  role: z.enum(['owner', 'editor', 'reader']),
})

/** List members of a space (any member can view the roster). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    await requireSpaceAccess(req, id, 'reader', authzDeps)
    return Response.json({ members: await db.listMembers(id) })
  } catch (err) {
    return toResponse(err)
  }
}

/** Add or update a member on a space. Requires owner role on that space. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await auth()
    if (!userId) throw new UnauthorizedError('sign in required')
    const { id } = await ctx.params

    await authorizeSpace(db.getMemberRole, { type: 'user', id: userId }, id, 'owner')

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))

    const member = await db.addMember(id, parsed.data.principalType, parsed.data.principalId, parsed.data.role, userId)
    return Response.json({ member }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}
