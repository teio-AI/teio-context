import { beforeEach, describe, expect, it, vi } from 'vitest'

// Dashboard read/manage endpoints. Auth is exercised for real via requireSpaceAccess:
// no Authorization header → Clerk path → authzDeps.getMemberRole decides the role.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getMemberRole: vi.fn(async () => 'reader' as const),
  getEnv: vi.fn(() => ({ STAFF_USER_IDS: 'staff-1' })),
  listMembers: vi.fn(async () => [{ id: 'm1', principal_type: 'user', principal_id: 'user_a', role: 'owner', created_by: 'user_a', created_at: 't' }]),
  removeMember: vi.fn(async () => true),
  listTokensMeta: vi.fn(async () => [{ id: 't1', name: 'ai', role: 'editor', token_prefix: 'tctx_x_ab', connector_id: null, created_by: 'u', created_at: 't', last_used_at: null, revoked_at: null, expires_at: null }]),
  listConnectors: vi.fn(async () => [{ id: 'c1', kind: 'mcp', name: 'agent', write_back_policy: 'proposal_only', status: 'active', created_at: 't' }]),
  getActivityStats: vi.fn(async () => ({ current_sha: 'abc', last_updated: 't', writes_7d: 3, docs: 5, open_proposals: 1 })),
  listRecentAudit: vi.fn(async () => [{ id: '1', ts: 't', actor_type: 'user', actor_id: 'u', actor_display: null, action: 'cas_write', path: 'context/a.md', outcome: 'ok' }]),
  insertAudit: vi.fn(async () => {}),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/env', () => ({ getEnv: h.getEnv }))
vi.mock('@/lib/wiring', () => ({
  authzDeps: { findTokenByPrefix: async () => null, getMemberRole: h.getMemberRole },
  getContextService: () => ({}),
}))
vi.mock('@/db', () => ({
  listMembers: h.listMembers,
  removeMember: h.removeMember,
  listTokensMeta: h.listTokensMeta,
  listConnectors: h.listConnectors,
  getActivityStats: h.getActivityStats,
  listRecentAudit: h.listRecentAudit,
  insertAudit: h.insertAudit,
  getMemberRole: h.getMemberRole,
}))

import { GET as membersGET } from '@/app/api/spaces/[id]/members/route'
import { DELETE as memberDELETE } from '@/app/api/spaces/[id]/members/[mid]/route'
import { GET as tokensGET } from '@/app/api/spaces/[id]/tokens/route'
import { GET as connectorsGET } from '@/app/api/spaces/[id]/connectors/route'
import { GET as activityGET } from '@/app/api/spaces/[id]/activity/route'
import { GET as meGET } from '@/app/api/me/route'

const req = (p = '/api/spaces/s1/x', init?: RequestInit) => new Request(`https://x.test${p}`, init)
const ctx = { params: Promise.resolve({ id: 's1' }) }
const midCtx = { params: Promise.resolve({ id: 's1', mid: 'm1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ userId: 'user_a' })
  h.getMemberRole.mockResolvedValue('reader')
  h.getEnv.mockReturnValue({ STAFF_USER_IDS: 'staff-1' })
  h.removeMember.mockResolvedValue(true)
})

describe('dashboard endpoints', () => {
  it('GET members → 200 for any member (reader)', async () => {
    const res = await membersGET(req('/api/spaces/s1/members'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).members).toHaveLength(1)
  })

  it('GET members → 401 when not signed in', async () => {
    h.auth.mockResolvedValue({ userId: null })
    expect((await membersGET(req('/api/spaces/s1/members'), ctx)).status).toBe(401)
  })

  it('DELETE member → 204 for owner', async () => {
    h.getMemberRole.mockResolvedValue('owner')
    const res = await memberDELETE(req('/api/spaces/s1/members/m1', { method: 'DELETE' }), midCtx)
    expect(res.status).toBe(204)
    expect(h.removeMember).toHaveBeenCalledWith('s1', 'm1')
  })

  it('DELETE member → 403 for editor (owner required)', async () => {
    h.getMemberRole.mockResolvedValue('editor')
    expect((await memberDELETE(req('/api/spaces/s1/members/m1', { method: 'DELETE' }), midCtx)).status).toBe(403)
    expect(h.removeMember).not.toHaveBeenCalled()
  })

  it('DELETE member → 404 when the member is absent', async () => {
    h.getMemberRole.mockResolvedValue('owner')
    h.removeMember.mockResolvedValue(false)
    expect((await memberDELETE(req('/api/spaces/s1/members/m1', { method: 'DELETE' }), midCtx)).status).toBe(404)
  })

  it('GET tokens → 200 for owner, and NEVER leaks a secret', async () => {
    h.getMemberRole.mockResolvedValue('owner')
    const res = await tokensGET(req('/api/spaces/s1/tokens'), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tokens[0]).not.toHaveProperty('token_hash')
    expect(JSON.stringify(body)).not.toContain('tctx_x_ab_') // only the prefix, never a full token
  })

  it('GET tokens → 403 for editor (owner-only)', async () => {
    h.getMemberRole.mockResolvedValue('editor')
    expect((await tokensGET(req('/api/spaces/s1/tokens'), ctx)).status).toBe(403)
  })

  it('GET connectors → 200 for a reader', async () => {
    const res = await connectorsGET(req('/api/spaces/s1/connectors'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).connectors).toHaveLength(1)
  })

  it('GET activity → 200 with stats + events', async () => {
    const res = await activityGET(req('/api/spaces/s1/activity'), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stats.writes_7d).toBe(3)
    expect(body.events).toHaveLength(1)
  })

  it('GET /api/me → reports staff flag', async () => {
    h.auth.mockResolvedValue({ userId: 'staff-1' })
    expect((await meGET()).status).toBe(200)
    expect((await (await meGET()).json()).isStaff).toBe(true)
    h.auth.mockResolvedValue({ userId: 'not-staff' })
    expect((await (await meGET()).json()).isStaff).toBe(false)
  })
})
