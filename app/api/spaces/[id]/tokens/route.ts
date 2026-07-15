import { z } from 'zod'
import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { generateToken } from '@/lib/auth/tokens'
import { getEnv } from '@/lib/env'
import { fetchUserEmails } from '@/lib/invitations'
import { ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

/**
 * GET /api/spaces/:id/tokens — SERVICE token metadata (admin only; never the
 * hash/plaintext). Project tokens are for non-human consumers; a human uses their
 * own PERSONAL token (dashboard) instead.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    await requireSpaceAccess(req, id, 'admin', authzDeps)
    const tokens = await db.listTokensMeta(id)

    // Resolve the creator's email so same-named tokens are distinguishable.
    const secretKey = getEnv().CLERK_SECRET_KEY
    const ownerIds = tokens.map((t) => t.created_by).filter((v): v is string => !!v)
    const emails = secretKey && ownerIds.length ? await fetchUserEmails(ownerIds, secretKey) : {}
    const enriched = tokens.map((t) => ({ ...t, owner_email: emails[t.created_by] ?? null }))
    return Response.json({ tokens: enriched })
  } catch (err) {
    return toResponse(err)
  }
}

const Body = z.object({
  name: z.string().min(1).max(200),
  role: z.enum(['reader', 'editor']),
  /** Opt-in: this token's writes open a PR instead of auto-merging. */
  proposalOnly: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
})

/**
 * POST /api/spaces/:id/tokens — issue a SERVICE token (admin only) for a
 * non-human consumer (the platform, CI, a customer integration), with an explicit
 * role and an optional "require review" flag. The plaintext is returned exactly
 * ONCE; only its hash is persisted. (Humans use a personal token instead.)
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))
    const { name, role, proposalOnly, expiresAt } = parsed.data

    const { principal } = await requireSpaceAccess(req, id, 'admin', authzDeps)

    const space = await db.getSpaceById(id)
    if (!space) throw new ValidationError('space not found')

    const generated = generateToken(space.slug)
    const { id: tokenId } = await db.insertApiToken({
      spaceId: id,
      name,
      tokenPrefix: generated.prefix,
      tokenHash: generated.hash,
      role,
      userId: null, // service identity, not a member
      proposalOnly,
      createdBy: principal.id,
      expiresAt,
    })

    await db.insertAudit({ spaceId: id, actorType: principal.type, actorId: principal.id, action: 'token_issue', path: null, outcome: 'ok', requestId: getRequestId(req) })

    // Shown exactly once — the caller must store it now; only the hash persists.
    return Response.json({ id: tokenId, token: generated.token, prefix: generated.prefix }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}
