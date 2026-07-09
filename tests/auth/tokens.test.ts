import { describe, expect, it } from 'vitest'
import { generateToken, hashToken, verifyToken } from '@/lib/auth/tokens'

describe('machine tokens', () => {
  it('round-trips generate → verify', () => {
    const g = generateToken('acme')
    expect(g.token.startsWith('tctx_acme_')).toBe(true)
    expect(g.prefix).toBe(g.token.slice(0, 12))
    expect(g.hash).toBe(hashToken(g.token))
    expect(verifyToken(g.token, g.hash)).toBe(true)
  })

  it('rejects a tampered or wrong token', () => {
    const g = generateToken('acme')
    expect(verifyToken(`${g.token}x`, g.hash)).toBe(false)
    expect(verifyToken('tctx_acme_wrong', g.hash)).toBe(false)
  })
})
