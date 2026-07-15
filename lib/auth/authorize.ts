import { ForbiddenError, ValidationError } from '../errors'
import type { Principal, Role } from '../context/types'

const RANK: Record<Role, number> = { reader: 1, editor: 2, admin: 3 }

export function hasRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required]
}

/** The stricter of two required roles (e.g. a move touching both context/** and space.yaml). */
export function higherRole(a: Role, b: Role): Role {
  return RANK[a] >= RANK[b] ? a : b
}

/** Resolve a principal's role on a space (from Neon space_members). null = not a member. */
export type MemberLookup = (spaceId: string, principalType: Principal['type'], principalId: string) => Promise<Role | null>

/**
 * Enforce that a principal has at least `required` role on a space.
 * Throws ForbiddenError otherwise. Returns the actual role on success.
 */
export async function authorizeSpace(
  lookup: MemberLookup,
  principal: Principal,
  spaceId: string,
  required: Role,
): Promise<Role> {
  const role = await lookup(spaceId, principal.type, principal.id)
  if (!role) throw new ForbiddenError('not a member of this space')
  if (!hasRole(role, required)) throw new ForbiddenError(`requires role '${required}', principal has '${role}'`)
  return role
}

/**
 * Reject path traversal / malformed paths before they reach the GitHub Contents
 * API, which could normalize `context/../x` OUT of the context/ sandbox. Applies
 * to reads and writes. Enforces a relative, `.`/`..`-free, no-empty-segment path.
 */
export function assertSafePath(path: string): void {
  if (!path || path !== path.trim() || path.startsWith('/')) {
    throw new ValidationError('path must be a non-empty relative path')
  }
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new ValidationError('path may not contain empty, "." or ".." segments')
  }
}

/**
 * Which role a write to `path` requires. space.yaml is an admin artifact
 * (members/connectors/policy), so it needs admin even though it is writable
 * markup (finding #12). Everything else must live under context/. Also rejects
 * traversal (assertSafePath) so a write can't escape the context/ sandbox.
 */
export function requiredRoleForPath(path: string): Role {
  assertSafePath(path)
  if (path === 'space.yaml') return 'admin'
  if (path.startsWith('context/')) return 'editor'
  throw new ValidationError(`path outside the write whitelist: ${path}`)
}
