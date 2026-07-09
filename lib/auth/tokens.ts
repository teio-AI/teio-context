import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export interface GeneratedToken {
  /** Full plaintext token — shown to the caller ONCE, never stored. */
  token: string
  /** First 12 chars, stored for lookup + display. */
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

export function tokenPrefix(token: string): string {
  return token.slice(0, 12)
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
