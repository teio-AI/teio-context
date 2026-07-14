import { describe, expect, it } from 'vitest'
import { generateToken, hashToken, tokenPrefix, verifyToken } from '@/lib/auth/tokens'

describe('machine tokens', () => {
  it('round-trips generate → verify', () => {
    const g = generateToken('acme')
    expect(g.token.startsWith('tctx_acme_')).toBe(true)
    expect(g.prefix).toBe(`tctx_acme_${g.token.slice('tctx_acme_'.length, 'tctx_acme_'.length + 8)}`)
    expect(tokenPrefix(g.token)).toBe(g.prefix) // recomputable from the plaintext on lookup
    expect(g.hash).toBe(hashToken(g.token))
    expect(verifyToken(g.token, g.hash)).toBe(true)
  })

  it('gives distinct prefixes to two tokens for the same slug (unique-index safe)', () => {
    // Regression: a slug-only prefix collided on `unique (token_prefix)`, so a
    // space could issue only one token before the second 500'd.
    const a = generateToken('acme')
    const b = generateToken('acme')
    expect(a.prefix).not.toBe(b.prefix)
  })

  it('includes random entropy even when the slug is long (>=7 chars)', () => {
    const g = generateToken('a-very-long-space-slug')
    expect(g.prefix.length).toBeGreaterThan('tctx_a-very-long-space-slug_'.length)
    expect(g.prefix.startsWith('tctx_a-very-long-space-slug_')).toBe(true)
  })

  it('rejects a tampered or wrong token', () => {
    const g = generateToken('acme')
    expect(verifyToken(`${g.token}x`, g.hash)).toBe(false)
    expect(verifyToken('tctx_acme_wrong', g.hash)).toBe(false)
  })
})
