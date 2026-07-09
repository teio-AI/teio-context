import { z } from 'zod'
import { higherRole, requiredRoleForPath } from '@/lib/auth/authorize'
import { requireSpaceAccess } from '@/lib/auth/context'
import { ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { authzDeps, getContextService } from '@/lib/wiring'

export const runtime = 'nodejs'

const Body = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  base_version: z.string().optional(),
})

/**
 * POST /api/spaces/:id/context/move — rename/move a path (a true git rename;
 * the source blob is reused). ARCHITECTURE §5 writes this `context:move`;
 * Next.js routes can't carry a literal colon, so it's a nested segment.
 * Role is the stricter of the two paths' required roles.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))
    const { from, to, base_version } = parsed.data

    const required = higherRole(requiredRoleForPath(from), requiredRoleForPath(to))
    const { principal } = await requireSpaceAccess(req, id, required, authzDeps)
    const result = await getContextService().movePath(principal, id, { from, to, baseVersion: base_version })
    return Response.json(result, { status: result.status === 'merged' ? 200 : 202 })
  } catch (err) {
    return toResponse(err)
  }
}
