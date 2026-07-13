import { beforeEach, describe, expect, it, vi } from 'vitest'

// Same mock pattern as context.route.test.ts, extended to the rest of the
// data-plane routes: version, search, proposals, move.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  insertAudit: vi.fn(async () => {}),
  findToken: vi.fn(),
  getMemberRole: vi.fn(async () => null),
  service: { getVersion: vi.fn(), search: vi.fn(), listProposals: vi.fn(), movePath: vi.fn() },
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/db', () => ({ insertAudit: h.insertAudit }))
vi.mock('@/lib/wiring', () => ({
  authzDeps: { findTokenByPrefix: h.findToken, getMemberRole: h.getMemberRole },
  getContextService: () => h.service,
}))

import { generateToken } from '@/lib/auth/tokens'
import { GET as versionGET } from '@/app/api/spaces/[id]/version/route'
import { GET as searchGET } from '@/app/api/spaces/[id]/search/route'
import { GET as proposalsGET } from '@/app/api/spaces/[id]/proposals/route'
import { POST as movePOST } from '@/app/api/spaces/[id]/context/move/route'

const ctx = { params: Promise.resolve({ id: 's1' }) }
const tok = generateToken('acme')
const row = (o = {}) => ({ id: 't1', space_id: 's1', token_hash: tok.hash, role: 'editor', connector_id: null, expires_at: null, revoked_at: null, ...o })

function get(url: string): Request {
  return new Request(`https://x.test${url}`, { headers: { authorization: `Bearer ${tok.token}` } })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ userId: null })
  h.findToken.mockResolvedValue(row())
})

describe('GET version', () => {
  it('reader+ → 200 with sha', async () => {
    h.service.getVersion.mockResolvedValue({ sha: 'abc', updatedAt: 't' })
    const res = await versionGET(get('/api/spaces/s1/version'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).sha).toBe('abc')
  })
  it('token bound to another space → 403', async () => {
    h.findToken.mockResolvedValue(row({ space_id: 'other' }))
    const res = await versionGET(get('/api/spaces/s1/version'), ctx)
    expect(res.status).toBe(403)
  })
})

describe('GET search', () => {
  it('returns results', async () => {
    h.service.search.mockResolvedValue([{ path: 'context/a.md', snippet: 's' }])
    const res = await searchGET(get('/api/spaces/s1/search?q=bill'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).results).toHaveLength(1)
  })
  it('missing q → 422', async () => {
    const res = await searchGET(get('/api/spaces/s1/search'), ctx)
    expect(res.status).toBe(422)
  })
})

describe('GET proposals', () => {
  it('returns open proposals', async () => {
    h.service.listProposals.mockResolvedValue([{ id: 'p1', status: 'open' }])
    const res = await proposalsGET(get('/api/spaces/s1/proposals'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).proposals).toHaveLength(1)
  })
})

describe('POST context/move', () => {
  function movereq(body: unknown): Request {
    return new Request('https://x.test/api/spaces/s1/context/move', {
      method: 'POST',
      headers: { authorization: `Bearer ${tok.token}` },
      body: JSON.stringify(body),
    })
  }

  it('valid move (merged) → 200', async () => {
    h.service.movePath.mockResolvedValue({ status: 'merged', version: 'v' })
    const res = await movePOST(movereq({ from: 'context/a.md', to: 'context/b.md' }), ctx)
    expect(res.status).toBe(200)
  })

  it('moving TO space.yaml with an editor token → 403 (owner required by stricter-of-two)', async () => {
    const res = await movePOST(movereq({ from: 'context/a.md', to: 'space.yaml' }), ctx)
    expect(res.status).toBe(403)
    expect(h.service.movePath).not.toHaveBeenCalled()
  })

  it('traversal in from → 422', async () => {
    const res = await movePOST(movereq({ from: 'context/../x', to: 'context/b.md' }), ctx)
    expect(res.status).toBe(422)
  })
})
