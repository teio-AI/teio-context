import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export interface GeneratedToken {
  /** Full plaintext token — shown to the caller ONCE, never stored. */
  token: string
  /** `tctx_<slug>_<8 random chars>`, stored for lookup + display. */
  prefix: string
  /** sha256(token) hex — the only thing persisted. */
  hash: string
}

/** `tctx_<slug>_<random>` — per-space machine token. */
export function generateToken(slug: string): GeneratedToken {
  const rand = randomBytes(24).toString('base64url')
  const token = `tctx_${slug}_${rand}`
  return { token, prefix: tokenPrefix(token), hash: hashToken(token) }
}

/**
 * The stored/lookup prefix: `tctx_<slug>_` plus the first 8 chars of the random
 * suffix. It MUST include random entropy — the slug repeats across every token
 * a space issues, so a slug-only prefix would collide on `unique (token_prefix)`
 * and let a space hold only one token. The slug is validated to contain no
 * underscore, so the second `_` (the first is in `tctx_`) marks the random
 * suffix start.
 */
export function tokenPrefix(token: string): string {
  const sep = token.indexOf('_', 5)
  if (sep === -1) return token.slice(0, 20)
  return token.slice(0, sep + 9) // slug separator + 8 random chars
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison of sha256(token) against the stored hash. */
export function verifyToken(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
