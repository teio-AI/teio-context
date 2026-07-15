import { auth } from '@clerk/nextjs/server'
import { ForbiddenError, UnauthorizedError } from '../errors'
import type { Principal, Role } from '../context/types'
import { getRequestId } from '../request-id'
import { authorizeSpace, hasRole, type MemberLookup } from './authorize'
import { resolveMachineToken, type TokenLookup } from './principal'

export interface AuthzDeps {
  findTokenByPrefix: TokenLookup
  getMemberRole: MemberLookup
  /** Is this Clerk user a global Owner (STAFF_USER_IDS)? Owners administer every space. */
  isGlobalOwner?: (userId: string) => boolean
  touchTokenLastUsed?: (tokenId: string) => Promise<void>
  /** Best-effort denial audit. Never allowed to mask the real error. */
  auditDenied?: (spaceId: string, principal: Principal, requestId?: string) => Promise<void>
}

export interface ResolvedAuth {
  principal: Principal
  /**
   * Present when the request authenticated via a machine token. Tokens are
   * bound to exactly one space with their own role (api_tokens.space_id/role)
   * — NOT looked up in space_members, which would be a second, driftable
   * source of truth for the same fact.
   */
  tokenBinding?: { spaceId: string; role: Role }
}

/** Resolve WHO is calling (machine token or Clerk session). No space-role check. */
export async function resolvePrincipal(req: Request, deps: AuthzDeps): Promise<ResolvedAuth> {
  const resolved = await resolveMachineToken(req.headers.get('authorization'), deps.findTokenByPrefix)
  if (resolved) {
    if (deps.touchTokenLastUsed) void deps.touchTokenLastUsed(resolved.row.id).catch(() => {})
    // A member-owned token's role follows the member's current membership (so a
    // role change / removal takes effect immediately). A service token carries
    // its own role.
    let role: Role | null = resolved.row.role
    if (resolved.row.user_id) {
      role = await deps.getMemberRole(resolved.row.space_id, 'user', resolved.row.user_id)
      if (!role) throw new UnauthorizedError('token owner is no longer a member of this space')
    }
    if (!role) throw new UnauthorizedError('token has no role')
    return { principal: resolved.principal, tokenBinding: { spaceId: resolved.row.space_id, role } }
  }

  const { userId } = await auth()
  if (!userId) throw new UnauthorizedError('sign in required')
  return { principal: { type: 'user', id: userId } }
}

/**
 * Resolve WHO is calling AND enforce they have at least `required` role on
 * `spaceId`. The one gate every space-scoped route must call before touching
 * ContextService (ARCHITECTURE §5: "Every route resolves a principal and
 * checks space role before any git/Neon work").
 */
export async function requireSpaceAccess(
  req: Request,
  spaceId: string,
  required: Role,
  deps: AuthzDeps,
): Promise<{ principal: Principal; role: Role }> {
  const resolved = await resolvePrincipal(req, deps)
  const requestId = getRequestId(req)

  if (resolved.tokenBinding) {
    const { spaceId: boundSpaceId, role } = resolved.tokenBinding
    const ok = boundSpaceId === spaceId && hasRole(role, required)
    if (!ok) {
      await deps.auditDenied?.(spaceId, resolved.principal, requestId).catch(() => {})
      throw new ForbiddenError(
        boundSpaceId !== spaceId ? 'token is not valid for this space' : `requires role '${required}', token has '${role}'`,
      )
    }
    return { principal: resolved.principal, role }
  }

  // A global Owner (staff) administers every space, member row or not — so a
  // project can never become invisible/unmanageable (even if all members left).
  if (resolved.principal.type === 'user' && deps.isGlobalOwner?.(resolved.principal.id)) {
    return { principal: resolved.principal, role: 'admin' }
  }

  try {
    const role = await authorizeSpace(deps.getMemberRole, resolved.principal, spaceId, required)
    return { principal: resolved.principal, role }
  } catch (err) {
    if (err instanceof ForbiddenError) await deps.auditDenied?.(spaceId, resolved.principal, requestId).catch(() => {})
    throw err
  }
}
