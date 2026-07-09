import { z } from 'zod'
import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { generateToken } from '@/lib/auth/tokens'
import { ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

const Body = z.object({
  name: z.string().min(1).max(200),
  role: z.enum(['reader', 'editor']),
  connectorId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
})

/**
 * POST /api/spaces/:id/tokens — issue a machine token (owner). The plaintext
 * token is returned exactly ONCE here; only its hash is ever persisted
 * (ARCHITECTURE §6). Binding to a connectorId makes this token's write-back
 * policy resolve through that connector (lib/wiring.ts resolveWritePolicy)
 * instead of falling through to the space default.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))
    const { name, role, connectorId, expiresAt } = parsed.data

    const { principal } = await requireSpaceAccess(req, id, 'owner', authzDeps)

    if (connectorId) {
      const connector = await db.getConnectorById(connectorId)
      if (!connector || connector.space_id !== id) {
        throw new ValidationError('connectorId does not belong to this space')
      }
    }

    const space = await db.getSpaceById(id)
    if (!space) throw new ValidationError('space not found')

    const generated = generateToken(space.slug)
    const { id: tokenId } = await db.insertApiToken({
      spaceId: id,
      name,
      tokenPrefix: generated.prefix,
      tokenHash: generated.hash,
      role,
      connectorId,
      createdBy: principal.id,
      expiresAt,
    })

    await db.insertAudit({
      spaceId: id,
      actorType: principal.type,
      actorId: principal.id,
      action: 'token_issue',
      path: null,
      outcome: 'ok',
    })

    // Shown exactly once — the caller must store it now; only the hash persists.
    return Response.json({ id: tokenId, token: generated.token, prefix: generated.prefix }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}
