import { z } from 'zod'
import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { hasRole } from '@/lib/auth/authorize'
import { generateToken } from '@/lib/auth/tokens'
import { getEnv } from '@/lib/env'
import { fetchUserEmails } from '@/lib/invitations'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

/**
 * GET /api/spaces/:id/tokens — token metadata (NEVER the hash/plaintext). Admins
 * see all tokens; a non-admin member sees only the tokens they created (so they
 * can manage/revoke their own — e.g. a compromised one).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const { principal, role } = await requireSpaceAccess(req, id, 'reader', authzDeps)
    const tokens = hasRole(role, 'admin') ? await db.listTokensMeta(id) : await db.listTokensMeta(id, principal.id)

    // Resolve the owner's email so two same-named tokens are distinguishable.
    const secretKey = getEnv().CLERK_SECRET_KEY
    const ownerIds = tokens.map((t) => t.user_id ?? t.created_by).filter((v): v is string => !!v)
    const emails = secretKey && ownerIds.length ? await fetchUserEmails(ownerIds, secretKey) : {}
    const enriched = tokens.map((t) => ({ ...t, owner_email: emails[t.user_id ?? t.created_by] ?? null }))
    return Response.json({ tokens: enriched })
  } catch (err) {
    return toResponse(err)
  }
}

const Body = z.object({
  name: z.string().min(1).max(200),
  /** Present → a SERVICE token with this explicit role (admin only). Absent → a
   *  member-owned token whose role follows the caller's membership. */
  role: z.enum(['reader', 'editor']).optional(),
  /** Opt-in: this token's writes open a PR instead of auto-merging. */
  proposalOnly: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
})

/**
 * POST /api/spaces/:id/tokens — issue a token. The plaintext is returned exactly
 * ONCE; only its hash is persisted (ARCHITECTURE §6).
 * - No `role` → a **member-owned** token: role follows the caller's membership
 *   (any member can mint their own, e.g. for their agent/MCP).
 * - `role` given → a **service** token with an explicit role (admin only), for
 *   non-human consumers (the platform, CI, a customer integration).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))
    const { name, role, proposalOnly, expiresAt } = parsed.data

    const { principal, role: callerRole } = await requireSpaceAccess(req, id, 'reader', authzDeps)

    let tokenRole: 'reader' | 'editor' | null
    let userId: string | null
    if (role) {
      // Service token — admin only.
      if (!hasRole(callerRole, 'admin')) throw new ForbiddenError('only admins can issue service tokens')
      tokenRole = role
      userId = null
    } else {
      // Member-owned token — role follows membership. Must be a signed-in member.
      if (principal.type !== 'user') throw new ValidationError('a member-owned token can only be minted by a signed-in member')
      tokenRole = null
      userId = principal.id
    }

    const space = await db.getSpaceById(id)
    if (!space) throw new ValidationError('space not found')

    const generated = generateToken(space.slug)
    const { id: tokenId } = await db.insertApiToken({
      spaceId: id,
      name,
      tokenPrefix: generated.prefix,
      tokenHash: generated.hash,
      role: tokenRole,
      userId,
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
