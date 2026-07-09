import { ForbiddenError, ValidationError } from '../errors'
import type { Principal, Role } from '../context/types'

const RANK: Record<Role, number> = { reader: 1, editor: 2, owner: 3 }

export function hasRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required]
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
 * Which role a write to `path` requires. space.yaml is an owner artifact
 * (owners/connectors/policy), so it needs owner even though it is writable
 * markup (finding #12). Everything else must live under context/.
 */
export function requiredRoleForPath(path: string): Role {
  if (path === 'space.yaml') return 'owner'
  if (path === 'context' || path.startsWith('context/')) return 'editor'
  throw new ValidationError(`path outside the write whitelist: ${path}`)
}
