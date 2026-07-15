import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }))

import type { AuthzDeps } from '@/lib/auth/context'
import { requireSpaceAccess, resolvePrincipal } from '@/lib/auth/context'
import type { TokenRow } from '@/lib/auth/principal'
import { generateToken } from '@/lib/auth/tokens'
import { ForbiddenError, UnauthorizedError } from '@/lib/errors'

function makeDeps(overrides: Partial<AuthzDeps> = {}): AuthzDeps {
  return { findTokenByPrefix: async () => null, getMemberRole: async () => null, ...overrides }
}

function reqWithAuth(header?: string): Request {
  return new Request('https://x.test/api/spaces/s1/context', header ? { headers: { authorization: header } } : {})
}

function tokenRow(overrides: Partial<TokenRow> = {}, hash: string): TokenRow {
  return {
    id: 't1',
    space_id: 's1',
    token_hash: hash,
    role: 'editor',
    user_id: null,
    proposal_only: false,
    expires_at: null,
    revoked_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  authMock.mockReset()
})

describe('resolvePrincipal', () => {
  it('resolves a valid machine token, bypassing Clerk entirely', async () => {
    const gen = generateToken('acme')
    const row = tokenRow({}, gen.hash)
    const deps = makeDeps({ findTokenByPrefix: async (prefix) => (prefix === gen.prefix ? row : null) })

    const resolved = await resolvePrincipal(reqWithAuth(`Bearer ${gen.token}`), deps)

    expect(resolved.principal).toEqual({ type: 'token', id: 't1' })
    expect(resolved.tokenBinding).toEqual({ spaceId: 's1', role: 'editor' })
    expect(authMock).not.toHaveBeenCalled()
  })

  it('falls back to Clerk when no bearer token is present', async () => {
    authMock.mockResolvedValue({ userId: 'user_1' })
    const resolved = await resolvePrincipal(reqWithAuth(), makeDeps())
    expect(resolved.principal).toEqual({ type: 'user', id: 'user_1' })
    expect(resolved.tokenBinding).toBeUndefined()
  })

  it('throws Unauthorized when there is no token and no Clerk session', async () => {
    authMock.mockResolvedValue({ userId: null })
    await expect(resolvePrincipal(reqWithAuth(), makeDeps())).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('requireSpaceAccess', () => {
  it('allows a token with sufficient role on the matching space', async () => {
    const gen = generateToken('acme')
    const deps = makeDeps({ findTokenByPrefix: async () => tokenRow({ role: 'editor' }, gen.hash) })
    const result = await requireSpaceAccess(reqWithAuth(`Bearer ${gen.token}`), 's1', 'reader', deps)
    expect(result.role).toBe('editor')
  })

  it('denies and audits a token bound to a different space', async () => {
    const gen = generateToken('acme')
    const auditDenied = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({ findTokenByPrefix: async () => tokenRow({ space_id: 's1' }, gen.hash), auditDenied })

    await expect(requireSpaceAccess(reqWithAuth(`Bearer ${gen.token}`), 's2', 'reader', deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    expect(auditDenied).toHaveBeenCalledWith('s2', { type: 'token', id: 't1' }, expect.any(String))
  })

  it('denies a token with insufficient role (no audit call throws)', async () => {
    const gen = generateToken('acme')
    const deps = makeDeps({ findTokenByPrefix: async () => tokenRow({ role: 'reader' }, gen.hash) })
    await expect(requireSpaceAccess(reqWithAuth(`Bearer ${gen.token}`), 's1', 'editor', deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('allows a Clerk user with sufficient role via space_members', async () => {
    authMock.mockResolvedValue({ userId: 'user_1' })
    const deps = makeDeps({ getMemberRole: async () => 'admin' })
    const result = await requireSpaceAccess(reqWithAuth(), 's1', 'editor', deps)
    expect(result.role).toBe('admin')
  })

  it('grants a global Owner admin on ANY space, even without a membership row', async () => {
    authMock.mockResolvedValue({ userId: 'owner_1' })
    const getMemberRole = vi.fn(async () => null) // not a member
    const deps = makeDeps({ getMemberRole, isGlobalOwner: (uid) => uid === 'owner_1' })
    const result = await requireSpaceAccess(reqWithAuth(), 's1', 'admin', deps)
    expect(result.role).toBe('admin')
    expect(getMemberRole).not.toHaveBeenCalled() // owner bypasses the membership lookup
  })

  it('denies and audits a Clerk user with no membership', async () => {
    authMock.mockResolvedValue({ userId: 'user_1' })
    const auditDenied = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({ getMemberRole: async () => null, auditDenied })

    await expect(requireSpaceAccess(reqWithAuth(), 's1', 'reader', deps)).rejects.toBeInstanceOf(ForbiddenError)
    expect(auditDenied).toHaveBeenCalledWith('s1', { type: 'user', id: 'user_1' }, expect.any(String))
  })

  it('does not audit when there is no session at all (Unauthorized, not a space-scoped denial)', async () => {
    authMock.mockResolvedValue({ userId: null })
    const auditDenied = vi.fn()
    await expect(requireSpaceAccess(reqWithAuth(), 's1', 'reader', makeDeps({ auditDenied }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
    expect(auditDenied).not.toHaveBeenCalled()
  })

  it('a failing audit write never masks the original ForbiddenError', async () => {
    authMock.mockResolvedValue({ userId: 'user_1' })
    const auditDenied = vi.fn().mockRejectedValue(new Error('audit db down'))
    await expect(
      requireSpaceAccess(reqWithAuth(), 's1', 'reader', makeDeps({ getMemberRole: async () => null, auditDenied })),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
