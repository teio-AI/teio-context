import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { InstallationTokenProvider, makeAppJwt } from '@/lib/github/app-auth'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
}

describe('makeAppJwt', () => {
  it('produces a verifiable RS256 JWT with correct claims', () => {
    const now = 1_700_000_000
    const jwt = makeAppJwt('4256555', privateKey, now)
    const [h, p, s] = jwt.split('.')

    expect(decodeSegment(h!)).toEqual({ alg: 'RS256', typ: 'JWT' })
    const payload = decodeSegment(p!)
    expect(payload.iss).toBe(4256555)
    expect(payload.iat).toBe(now - 60)
    expect(payload.exp).toBe(now + 540)

    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${h}.${p}`)
    verifier.end()
    const sig = Buffer.from(s!.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    expect(verifier.verify(publicKey, sig)).toBe(true)
  })
})

describe('InstallationTokenProvider', () => {
  it('mints an installation token and caches it', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: 'ghs_abc', expires_at: new Date(Date.now() + 3_600_000).toISOString() }), {
          status: 201,
        }),
    )
    const provider = new InstallationTokenProvider('1', privateKey, fetchImpl as unknown as typeof fetch)

    const t1 = await provider.getToken(42)
    const t2 = await provider.getToken(42)

    expect(t1).toBe('ghs_abc')
    expect(t2).toBe('ghs_abc')
    expect(fetchImpl).toHaveBeenCalledTimes(1) // second call served from cache
  })
})
