import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  insertApiToken: vi.fn(async () => ({ id: 'pt1' })),
  listPersonalTokens: vi.fn(async () => [{ id: 'pt1', name: 'laptop', role: null, user_id: 'user_a', proposal_only: false, token_prefix: 'tctx_me_ab', created_by: 'user_a', created_at: 't', last_used_at: null, revoked_at: null, expires_at: null }]),
  revokePersonalToken: vi.fn(async () => true),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/db', () => ({ insertApiToken: h.insertApiToken, listPersonalTokens: h.listPersonalTokens, revokePersonalToken: h.revokePersonalToken }))

import { GET as listGET, POST as createPOST } from '@/app/api/me/tokens/route'
import { DELETE as revokeDELETE } from '@/app/api/me/tokens/[tid]/route'

const req = (body?: unknown) => new Request('https://x.test/api/me/tokens', body ? { method: 'POST', body: JSON.stringify(body) } : {})

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ userId: 'user_a' })
  h.revokePersonalToken.mockResolvedValue(true)
})

describe('/api/me/tokens (personal tokens)', () => {
  it('POST mints a space-unbound token for the current user (space_id null, role null)', async () => {
    const res = await createPOST(req({ name: 'laptop' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.token).toMatch(/^tctx_me_/)
    expect(h.insertApiToken).toHaveBeenCalledWith(expect.objectContaining({ spaceId: null, userId: 'user_a', role: null }))
  })

  it('POST → 401 when signed out', async () => {
    h.auth.mockResolvedValue({ userId: null })
    expect((await createPOST(req({ name: 'x' }))).status).toBe(401)
  })

  it('GET lists the user\'s personal tokens (no secret)', async () => {
    const body = await (await listGET()).json()
    expect(body.tokens).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain('token_hash')
  })

  it('DELETE revokes only the caller\'s own personal token', async () => {
    const res = await revokeDELETE(new Request('https://x.test/api/me/tokens/pt1', { method: 'DELETE' }), { params: Promise.resolve({ tid: 'pt1' }) })
    expect(res.status).toBe(204)
    expect(h.revokePersonalToken).toHaveBeenCalledWith('user_a', 'pt1')
  })

  it('DELETE → 404 when not found / not yours', async () => {
    h.revokePersonalToken.mockResolvedValue(false)
    const res = await revokeDELETE(new Request('https://x.test/api/me/tokens/pt9', { method: 'DELETE' }), { params: Promise.resolve({ tid: 'pt9' }) })
    expect(res.status).toBe(404)
  })
})
