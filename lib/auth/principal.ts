import { UnauthorizedError } from '../errors'
import type { Principal } from '../context/types'
import { tokenPrefix, verifyToken } from './tokens'

export interface TokenRow {
  id: string
  /** null for a PERSONAL token — it authenticates as `user_id` across all projects. */
  space_id: string | null
  token_hash: string
  /** null for a member-owned token (role follows the member); set for a service token. */
  role: 'reader' | 'editor' | null
  /** set when the token belongs to a member — effective role follows their membership. */
  user_id: string | null
  proposal_only: boolean
  expires_at: string | null
  revoked_at: string | null
}

export type TokenLookup = (prefix: string) => Promise<TokenRow | null>

export interface ResolvedToken {
  principal: Principal
  row: TokenRow
}

/**
 * Resolve a machine token from an Authorization header.
 * Returns null when the header carries no teio-context token (so the caller can
 * fall back to a Clerk session). Throws UnauthorizedError when a token is
 * present but invalid/expired/revoked.
 */
export async function resolveMachineToken(
  authHeader: string | null,
  lookup: TokenLookup,
): Promise<ResolvedToken | null> {
  if (!authHeader) return null
  const match = /^Bearer\s+(tctx_[A-Za-z0-9_-]+)$/.exec(authHeader.trim())
  if (!match) return null
  const token = match[1]!

  const row = await lookup(tokenPrefix(token))
  if (!row) throw new UnauthorizedError('unknown token')
  if (row.revoked_at) throw new UnauthorizedError('token revoked')
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) throw new UnauthorizedError('token expired')
  if (!verifyToken(token, row.token_hash)) throw new UnauthorizedError('invalid token')

  return { principal: { type: 'token', id: row.id }, row }
}
