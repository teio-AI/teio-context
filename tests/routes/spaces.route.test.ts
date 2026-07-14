import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/spaces (staff-only space creation). Exercises the slug pre-check
// and the repo rollback-on-insert-failure that keep provisioning + Neon from
// drifting into orphaned repos.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getEnv: vi.fn(() => ({ STAFF_USER_IDS: 'staff-1' })),
  getGitHubConfig: vi.fn(() => ({
    appId: 1,
    privateKey: 'k',
    org: 'teio-context-dev',
    ownerType: 'org' as const,
    visibility: 'public' as const,
  })),
  getInstallationId: vi.fn(async () => 123),
  getToken: vi.fn(async () => 'inst-token'),
  provisionSpaceRepo: vi.fn(async () => ({
    owner: 'teio-context-dev',
    repo: 'teio-context-acme',
    defaultBranch: 'main',
    mainSha: 'sha0',
    rulesetId: 7,
  })),
  ghRequest: vi.fn(async () => ({ status: 204, data: {} })),
  getSpaceBySlug: vi.fn(async (): Promise<{ id: string; slug: string } | null> => null),
  createSpace: vi.fn(async () => ({ id: 's1', slug: 'acme' })),
  addMember: vi.fn(async () => ({ id: 'm1' })),
  insertAudit: vi.fn(async () => {}),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/env', () => ({ getEnv: h.getEnv, getGitHubConfig: h.getGitHubConfig }))
vi.mock('@/lib/github/app-auth', () => ({ getInstallationId: h.getInstallationId }))
vi.mock('@/lib/github/singleton', () => ({ getInstallationTokenProvider: () => ({ getToken: h.getToken }) }))
vi.mock('@/lib/github/client', () => ({ GitHubClient: class { request = h.ghRequest } }))
vi.mock('@/lib/github/provision', () => ({ provisionSpaceRepo: h.provisionSpaceRepo }))
vi.mock('@/lib/wiring', () => ({ authzDeps: {}, getContextService: () => ({}) }))
vi.mock('@/db', () => ({
  getSpaceBySlug: h.getSpaceBySlug,
  createSpace: h.createSpace,
  addMember: h.addMember,
  insertAudit: h.insertAudit,
}))

import { POST } from '@/app/api/spaces/route'

function post(body: unknown): Request {
  return new Request('https://x.test/api/spaces', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ userId: 'staff-1' })
  h.getEnv.mockReturnValue({ STAFF_USER_IDS: 'staff-1' })
  h.getSpaceBySlug.mockResolvedValue(null)
})

describe('POST /api/spaces', () => {
  it('rejects a non-staff user with 403', async () => {
    h.auth.mockResolvedValue({ userId: 'not-staff' })
    const res = await POST(post({ slug: 'acme', name: 'Acme' }))
    expect(res.status).toBe(403)
    expect(h.provisionSpaceRepo).not.toHaveBeenCalled()
  })

  it('returns 409 for a duplicate slug WITHOUT provisioning a repo', async () => {
    h.getSpaceBySlug.mockResolvedValue({ id: 'existing', slug: 'acme' })
    const res = await POST(post({ slug: 'acme', name: 'Acme' }))
    expect(res.status).toBe(409)
    expect(h.provisionSpaceRepo).not.toHaveBeenCalled()
    expect(h.createSpace).not.toHaveBeenCalled()
  })

  it('provisions, registers, and makes the creator an owner on success (201)', async () => {
    const res = await POST(post({ slug: 'acme', name: 'Acme' }))
    expect(res.status).toBe(201)
    expect(h.provisionSpaceRepo).toHaveBeenCalledOnce()
    expect(h.createSpace).toHaveBeenCalledOnce()
    expect(h.addMember).toHaveBeenCalledWith('s1', 'user', 'staff-1', 'owner', 'staff-1')
    expect(h.ghRequest).not.toHaveBeenCalled() // no rollback on the happy path
  })

  it('rolls the repo back (DELETE) when the Neon insert fails after provisioning', async () => {
    h.createSpace.mockRejectedValue(new Error('neon down'))
    const res = await POST(post({ slug: 'acme', name: 'Acme' }))
    expect(res.status).toBe(500)
    expect(h.provisionSpaceRepo).toHaveBeenCalledOnce()
    expect(h.ghRequest).toHaveBeenCalledWith('DELETE', '/repos/teio-context-dev/teio-context-acme')
  })
})
