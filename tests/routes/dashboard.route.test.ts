import { beforeEach, describe, expect, it, vi } from 'vitest'

// Dashboard read/manage + invite endpoints. Auth is exercised for real via
// requireSpaceAccess: no Authorization header → Clerk path → getMemberRole decides.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(async (): Promise<{ emailAddresses: { emailAddress: string; verification: { status: string } }[] } | null> => ({ emailAddresses: [] })),
  getMemberRole: vi.fn(async (): Promise<'admin' | 'editor' | 'reader'> => 'reader'),
  getEnv: vi.fn(() => ({ STAFF_USER_IDS: 'staff-1', CLERK_SECRET_KEY: 'sk_test' })),
  sendClerkInvitation: vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'clerk_inv_1' })),
  revokeClerkInvitation: vi.fn(async () => {}),
  fetchUserEmails: vi.fn(async (): Promise<Record<string, string>> => ({ user_a: 'a@co.com' })),
  listMembers: vi.fn(async () => [{ id: 'm1', principal_type: 'user', principal_id: 'user_a', role: 'admin', created_by: 'user_a', created_at: 't' }]),
  removeMember: vi.fn(async () => true),
  getSpaceMember: vi.fn(async (): Promise<{ id: string; role: string; principal_id: string } | null> => ({ id: 'm1', role: 'editor', principal_id: 'user_z' })),
  countSpaceAdmins: vi.fn(async () => 2),
  isGlobalOwner: vi.fn((_uid: string) => false),
  revokeToken: vi.fn(async () => true),
  revokeOwnToken: vi.fn(async () => true),
  addMember: vi.fn(async () => ({ id: 'm9' })),
  createPendingInvitation: vi.fn(async () => ({ id: 'inv1' })),
  cancelPendingInvitation: vi.fn(async (): Promise<{ clerk_invitation_id: string | null } | null> => ({ clerk_invitation_id: 'clerk_inv_1' })),
  getPendingInvitation: vi.fn(async (): Promise<{ id: string; clerk_invitation_id: string | null } | null> => null),
  getSpaceById: vi.fn(async () => ({ id: 's1', slug: 'acme' })),
  insertApiToken: vi.fn(async () => ({ id: 'tk1' })),
  listPendingInvitations: vi.fn(async () => [{ id: 'inv1', space_id: 's1', email: 'p@co.com', role: 'editor', invited_by: 'user_a', created_at: 't' }]),
  listPendingForEmail: vi.fn(async (): Promise<{ id: string; space_id: string; role: string; email: string; invited_by: string; created_at: string }[]> => []),
  deletePendingInvitationById: vi.fn(async () => {}),
  listTokensMeta: vi.fn(async () => [{ id: 't1', name: 'ai', role: 'editor', user_id: null, proposal_only: true, token_prefix: 'tctx_x_ab', created_by: 'u', created_at: 't', last_used_at: null, revoked_at: null, expires_at: null }]),
  getActivityStats: vi.fn(async () => ({ current_sha: 'abc', last_updated: 't', writes_7d: 3, docs: 5, open_proposals: 1 })),
  listRecentAudit: vi.fn(async () => [{ id: '1', ts: 't', actor_type: 'user', actor_id: 'u', actor_display: null, action: 'cas_write', path: 'context/a.md', outcome: 'ok' }]),
  insertAudit: vi.fn(async () => {}),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth, currentUser: h.currentUser }))
vi.mock('@/lib/env', () => ({ getEnv: h.getEnv }))
vi.mock('@/lib/invitations', () => ({ sendClerkInvitation: h.sendClerkInvitation, revokeClerkInvitation: h.revokeClerkInvitation, fetchUserEmails: h.fetchUserEmails }))
vi.mock('@/lib/wiring', () => ({
  authzDeps: { findTokenByPrefix: async () => null, getMemberRole: h.getMemberRole, isGlobalOwner: h.isGlobalOwner },
  getContextService: () => ({}),
  isGlobalOwner: h.isGlobalOwner,
}))
vi.mock('@/db', () => ({
  listMembers: h.listMembers, removeMember: h.removeMember, addMember: h.addMember,
  getSpaceMember: h.getSpaceMember, countSpaceAdmins: h.countSpaceAdmins,
  revokeToken: h.revokeToken, revokeOwnToken: h.revokeOwnToken,
  createPendingInvitation: h.createPendingInvitation, listPendingInvitations: h.listPendingInvitations,
  listPendingForEmail: h.listPendingForEmail, deletePendingInvitationById: h.deletePendingInvitationById,
  listTokensMeta: h.listTokensMeta, getActivityStats: h.getActivityStats,
  listRecentAudit: h.listRecentAudit, insertAudit: h.insertAudit, getMemberRole: h.getMemberRole,
  cancelPendingInvitation: h.cancelPendingInvitation, getPendingInvitation: h.getPendingInvitation,
  getSpaceById: h.getSpaceById, insertApiToken: h.insertApiToken,
}))

import { GET as membersGET, POST as membersPOST } from '@/app/api/spaces/[id]/members/route'
import { DELETE as memberDELETE } from '@/app/api/spaces/[id]/members/[mid]/route'
import { GET as tokensGET, POST as tokensPOST } from '@/app/api/spaces/[id]/tokens/route'
import { DELETE as tokenDELETE } from '@/app/api/spaces/[id]/tokens/[tid]/route'
import { DELETE as inviteDELETE } from '@/app/api/spaces/[id]/invitations/[inviteId]/route'
import { GET as activityGET } from '@/app/api/spaces/[id]/activity/route'
import { GET as meGET } from '@/app/api/me/route'

const req = (p = '/api/spaces/s1/x', init?: RequestInit) => new Request(`https://x.test${p}`, init)
const post = (body: unknown) => req('/api/spaces/s1/members', { method: 'POST', body: JSON.stringify(body) })
const ctx = { params: Promise.resolve({ id: 's1' }) }
const midCtx = { params: Promise.resolve({ id: 's1', mid: 'm1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ userId: 'user_a' })
  h.currentUser.mockResolvedValue({ emailAddresses: [] })
  h.getMemberRole.mockResolvedValue('reader')
  h.getEnv.mockReturnValue({ STAFF_USER_IDS: 'staff-1', CLERK_SECRET_KEY: 'sk_test' })
  h.removeMember.mockResolvedValue(true)
  h.listPendingForEmail.mockResolvedValue([])
  h.getPendingInvitation.mockResolvedValue(null)
  h.cancelPendingInvitation.mockResolvedValue({ clerk_invitation_id: 'clerk_inv_1' })
  h.getSpaceMember.mockResolvedValue({ id: 'm1', role: 'editor', principal_id: 'user_z' })
  h.countSpaceAdmins.mockResolvedValue(2)
  h.isGlobalOwner.mockReturnValue(false)
})

describe('dashboard endpoints', () => {
  it('GET members → 200 for any member; pending hidden from non-admins', async () => {
    const res = await membersGET(req('/api/spaces/s1/members'), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.members).toHaveLength(1)
    expect(body.members[0].email).toBe('a@co.com') // resolved from Clerk for display
    expect(body.pending).toEqual([]) // reader doesn't see pending invites
  })

  it('GET members → admins also see pending invitations', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    const body = await (await membersGET(req('/api/spaces/s1/members'), ctx)).json()
    expect(body.pending).toHaveLength(1)
  })

  it('GET members → 401 when not signed in', async () => {
    h.auth.mockResolvedValue({ userId: null })
    expect((await membersGET(req('/api/spaces/s1/members'), ctx)).status).toBe(401)
  })

  it('POST members (invite by email) → 201 as admin; records pending invite', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    const res = await membersPOST(post({ email: 'New@Co.com', role: 'editor' }), ctx)
    expect(res.status).toBe(201)
    expect(h.createPendingInvitation).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 's1', email: 'New@Co.com', role: 'editor' }))
  })

  it('POST members → 403 for editor (admin required to invite)', async () => {
    h.getMemberRole.mockResolvedValue('editor')
    expect((await membersPOST(post({ email: 'x@y.com', role: 'reader' }), ctx)).status).toBe(403)
    expect(h.createPendingInvitation).not.toHaveBeenCalled()
  })

  it('POST members → 422 on a non-email', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    expect((await membersPOST(post({ email: 'not-an-email', role: 'reader' }), ctx)).status).toBe(422)
  })

  it('DELETE member → 204 for admin', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    const res = await memberDELETE(req('/api/spaces/s1/members/m1', { method: 'DELETE' }), midCtx)
    expect(res.status).toBe(204)
    expect(h.removeMember).toHaveBeenCalledWith('s1', 'm1')
  })

  it('DELETE member → 403 for editor (admin required)', async () => {
    h.getMemberRole.mockResolvedValue('editor')
    expect((await memberDELETE(req('/api/spaces/s1/members/m1', { method: 'DELETE' }), midCtx)).status).toBe(403)
    expect(h.removeMember).not.toHaveBeenCalled()
  })

  it('DELETE member → 404 when the member is absent', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    h.getSpaceMember.mockResolvedValue(null)
    expect((await memberDELETE(req('/api/spaces/s1/members/m1', { method: 'DELETE' }), midCtx)).status).toBe(404)
  })

  it('DELETE member → 422 when removing the LAST admin (no orphaned project)', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    h.getSpaceMember.mockResolvedValue({ id: 'm1', role: 'admin', principal_id: 'user_z' })
    h.countSpaceAdmins.mockResolvedValue(1)
    expect((await memberDELETE(req('/api/spaces/s1/members/m1', { method: 'DELETE' }), midCtx)).status).toBe(422)
    expect(h.removeMember).not.toHaveBeenCalled()
  })

  it('DELETE member → 422 when the target is a global Owner (never removable)', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    h.getSpaceMember.mockResolvedValue({ id: 'm1', role: 'admin', principal_id: 'user_owner' })
    h.countSpaceAdmins.mockResolvedValue(3)
    h.isGlobalOwner.mockImplementation((uid: string) => uid === 'user_owner')
    expect((await memberDELETE(req('/api/spaces/s1/members/m1', { method: 'DELETE' }), midCtx)).status).toBe(422)
    expect(h.removeMember).not.toHaveBeenCalled()
  })

  it('GET tokens → 200 for admin, and NEVER leaks a secret', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    const res = await tokensGET(req('/api/spaces/s1/tokens'), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tokens[0]).not.toHaveProperty('token_hash')
    expect(JSON.stringify(body)).not.toContain('tctx_x_ab_') // only the prefix, never a full token
  })

  it('GET tokens → editor sees their OWN tokens (scoped by creator)', async () => {
    h.getMemberRole.mockResolvedValue('editor')
    const res = await tokensGET(req('/api/spaces/s1/tokens'), ctx)
    expect(res.status).toBe(200)
    expect(h.listTokensMeta).toHaveBeenCalledWith('s1', 'user_a') // scoped to the caller
  })

  it('DELETE token → admin revokes ANY token (revokeToken)', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    const res = await tokenDELETE(req('/api/spaces/s1/tokens/tk1', { method: 'DELETE' }), { params: Promise.resolve({ id: 's1', tid: 'tk1' }) })
    expect(res.status).toBe(200)
    expect(h.revokeToken).toHaveBeenCalledWith('s1', 'tk1')
    expect(h.revokeOwnToken).not.toHaveBeenCalled()
  })

  it('DELETE token → non-admin can only revoke their OWN (revokeOwnToken)', async () => {
    h.getMemberRole.mockResolvedValue('editor')
    const res = await tokenDELETE(req('/api/spaces/s1/tokens/tk1', { method: 'DELETE' }), { params: Promise.resolve({ id: 's1', tid: 'tk1' }) })
    expect(res.status).toBe(200)
    expect(h.revokeOwnToken).toHaveBeenCalledWith('s1', 'tk1', 'user_a')
    expect(h.revokeToken).not.toHaveBeenCalled()
  })

  it('POST tokens: a reader CANNOT mint a service editor token (403, no escalation)', async () => {
    h.getMemberRole.mockResolvedValue('reader')
    const res = await tokensPOST(req('/api/spaces/s1/tokens', { method: 'POST', body: JSON.stringify({ name: 'x', role: 'editor' }) }), ctx)
    expect(res.status).toBe(403)
    expect(h.insertApiToken).not.toHaveBeenCalled()
  })

  it('POST tokens: a reader CAN mint their own token — role inherits (null), not picked', async () => {
    h.getMemberRole.mockResolvedValue('reader')
    const res = await tokensPOST(req('/api/spaces/s1/tokens', { method: 'POST', body: JSON.stringify({ name: 'my-agent' }) }), ctx)
    expect(res.status).toBe(201)
    expect(h.insertApiToken).toHaveBeenCalledWith(expect.objectContaining({ role: null, userId: 'user_a' }))
  })

  it('POST members: re-inviting revokes the stale Clerk invitation first (so email re-sends)', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    h.getPendingInvitation.mockResolvedValue({ id: 'inv1', clerk_invitation_id: 'clerk_old' })
    await membersPOST(post({ email: 'x@y.com', role: 'reader' }), ctx)
    expect(h.revokeClerkInvitation).toHaveBeenCalledWith('clerk_old', 'sk_test')
    expect(h.createPendingInvitation).toHaveBeenCalledWith(expect.objectContaining({ clerkInvitationId: 'clerk_inv_1' }))
  })

  it('DELETE invitation → 204 for admin, and revokes the Clerk invitation', async () => {
    h.getMemberRole.mockResolvedValue('admin')
    const res = await inviteDELETE(req('/api/spaces/s1/invitations/inv1', { method: 'DELETE' }), { params: Promise.resolve({ id: 's1', inviteId: 'inv1' }) })
    expect(res.status).toBe(204)
    expect(h.cancelPendingInvitation).toHaveBeenCalledWith('s1', 'inv1')
    expect(h.revokeClerkInvitation).toHaveBeenCalledWith('clerk_inv_1', 'sk_test')
  })

  it('DELETE invitation → 403 for editor', async () => {
    h.getMemberRole.mockResolvedValue('editor')
    const res = await inviteDELETE(req('/api/spaces/s1/invitations/inv1', { method: 'DELETE' }), { params: Promise.resolve({ id: 's1', inviteId: 'inv1' }) })
    expect(res.status).toBe(403)
    expect(h.cancelPendingInvitation).not.toHaveBeenCalled()
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
    expect((await (await meGET()).json()).isStaff).toBe(true)
    h.auth.mockResolvedValue({ userId: 'not-staff' })
    expect((await (await meGET()).json()).isStaff).toBe(false)
  })

  it('GET /api/me → reconciles a pending invite for a verified email into a membership', async () => {
    h.currentUser.mockResolvedValue({ emailAddresses: [{ emailAddress: 'a@b.com', verification: { status: 'verified' } }] })
    h.listPendingForEmail.mockResolvedValue([{ id: 'inv9', space_id: 's9', role: 'editor', email: 'a@b.com', invited_by: 'admin_x', created_at: 't' }])
    const body = await (await meGET()).json()
    expect(h.addMember).toHaveBeenCalledWith('s9', 'user', 'user_a', 'editor', 'admin_x')
    expect(h.deletePendingInvitationById).toHaveBeenCalledWith('inv9')
    expect(body.joined).toEqual([{ spaceId: 's9', role: 'editor' }])
  })

  it('GET /api/me → ignores invites to an UNVERIFIED email', async () => {
    h.currentUser.mockResolvedValue({ emailAddresses: [{ emailAddress: 'a@b.com', verification: { status: 'unverified' } }] })
    await meGET()
    expect(h.listPendingForEmail).not.toHaveBeenCalled()
    expect(h.addMember).not.toHaveBeenCalled()
  })
})
