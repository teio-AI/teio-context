import { beforeEach, describe, expect, it, vi } from 'vitest'

// Route handlers compose: parse → assertSafePath/requiredRoleForPath → real
// requireSpaceAccess → service → HTTP status/error mapping. Nothing tested this
// composition before (it was only reachable by deploying). Here auth + service
// are mocked, but requireSpaceAccess/authorize/toResponse are the REAL code.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  insertAudit: vi.fn(async () => {}),
  findToken: vi.fn(),
  getMemberRole: vi.fn(async () => null),
  service: { getDocument: vi.fn(), proposeUpdate: vi.fn(), deletePath: vi.fn() },
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/db', () => ({ insertAudit: h.insertAudit }))
vi.mock('@/lib/wiring', () => ({
  authzDeps: { findTokenByPrefix: h.findToken, getMemberRole: h.getMemberRole },
  getContextService: () => h.service,
}))

import { AppError, RateLimitedError, UnknownBaseError } from '@/lib/errors'
import { generateToken } from '@/lib/auth/tokens'
import { DELETE, GET, POST } from '@/app/api/spaces/[id]/context/route'

const ctx = { params: Promise.resolve({ id: 's1' }) }
const editor = generateToken('acme')

function tokenRow(overrides = {}) {
  return { id: 't1', space_id: 's1', token_hash: editor.hash, role: 'editor', connector_id: null, expires_at: null, revoked_at: null, ...overrides }
}

function req(opts: { method?: string; token?: string; path?: string; base_version?: string; body?: unknown } = {}): Request {
  const u = new URL('https://x.test/api/spaces/s1/context')
  if (opts.path) u.searchParams.set('path', opts.path)
  if (opts.base_version) u.searchParams.set('base_version', opts.base_version)
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  return new Request(u, { method: opts.method ?? 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ userId: null })
  h.findToken.mockResolvedValue(tokenRow()) // valid editor token on space s1
})

describe('POST /api/spaces/:id/context', () => {
  it('merged write → 200', async () => {
    h.service.proposeUpdate.mockResolvedValue({ status: 'merged', version: 'v1' })
    const res = await POST(req({ method: 'POST', token: editor.token, body: { path: 'context/a.md', content: 'hi' } }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'merged', version: 'v1' })
  })

  it('proposal/conflict (PR opened) → 202', async () => {
    h.service.proposeUpdate.mockResolvedValue({ status: 'proposal', prUrl: 'https://gh/pr/1', proposalId: 'p1' })
    const res = await POST(req({ method: 'POST', token: editor.token, body: { path: 'context/a.md', content: 'hi' } }), ctx)
    expect(res.status).toBe(202)
  })

  it('space.yaml with an editor token → 403 (owner required)', async () => {
    const res = await POST(req({ method: 'POST', token: editor.token, body: { path: 'space.yaml', content: 'x' } }), ctx)
    expect(res.status).toBe(403)
    expect(h.service.proposeUpdate).not.toHaveBeenCalled()
  })

  it('traversal path → 422 before any service call', async () => {
    const res = await POST(req({ method: 'POST', token: editor.token, body: { path: 'context/../secrets.md', content: 'x' } }), ctx)
    expect(res.status).toBe(422)
    expect(h.service.proposeUpdate).not.toHaveBeenCalled()
  })

  it('invalid body (missing content) → 422', async () => {
    const res = await POST(req({ method: 'POST', token: editor.token, body: { path: 'context/a.md' } }), ctx)
    expect(res.status).toBe(422)
  })

  it('no auth → 401', async () => {
    const res = await POST(req({ method: 'POST', body: { path: 'context/a.md', content: 'hi' } }), ctx)
    expect(res.status).toBe(401)
  })

  it('service UnknownBaseError → 409', async () => {
    h.service.proposeUpdate.mockRejectedValue(new UnknownBaseError())
    const res = await POST(req({ method: 'POST', token: editor.token, body: { path: 'context/a.md', content: 'hi' } }), ctx)
    expect(res.status).toBe(409)
  })

  it('service RateLimitedError → 429 with Retry-After', async () => {
    h.service.proposeUpdate.mockRejectedValue(new RateLimitedError(30, 'POST /merges'))
    const res = await POST(req({ method: 'POST', token: editor.token, body: { path: 'context/a.md', content: 'hi' } }), ctx)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
  })

  it('service github_unconfigured → 503', async () => {
    h.service.proposeUpdate.mockRejectedValue(new AppError('nope', 'github_unconfigured', 503))
    const res = await POST(req({ method: 'POST', token: editor.token, body: { path: 'context/a.md', content: 'hi' } }), ctx)
    expect(res.status).toBe(503)
  })

  it('token bound to a different space → 403', async () => {
    h.findToken.mockResolvedValue(tokenRow({ space_id: 'other' }))
    const res = await POST(req({ method: 'POST', token: editor.token, body: { path: 'context/a.md', content: 'hi' } }), ctx)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/spaces/:id/context', () => {
  it('valid read → 200', async () => {
    h.service.getDocument.mockResolvedValue({ path: 'context/a.md', content: 'hi', version: 'v', blob: 'b' })
    const res = await GET(req({ token: editor.token, path: 'context/a.md' }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).content).toBe('hi')
  })

  it('missing path param → 422', async () => {
    const res = await GET(req({ token: editor.token }), ctx)
    expect(res.status).toBe(422)
  })

  it('traversal path → 422', async () => {
    const res = await GET(req({ token: editor.token, path: 'context/../x' }), ctx)
    expect(res.status).toBe(422)
    expect(h.service.getDocument).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/spaces/:id/context', () => {
  it('valid delete (merged) → 200', async () => {
    h.service.deletePath.mockResolvedValue({ status: 'merged', version: 'v2' })
    const res = await DELETE(req({ method: 'DELETE', token: editor.token, path: 'context/a.md' }), ctx)
    expect(res.status).toBe(200)
  })

  it('reader token cannot delete → 403', async () => {
    h.findToken.mockResolvedValue(tokenRow({ role: 'reader' }))
    const res = await DELETE(req({ method: 'DELETE', token: editor.token, path: 'context/a.md' }), ctx)
    expect(res.status).toBe(403)
    expect(h.service.deletePath).not.toHaveBeenCalled()
  })
})
