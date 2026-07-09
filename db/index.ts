import type { MemberLookup } from '@/lib/auth/authorize'
import type { TokenRow } from '@/lib/auth/principal'
import type { Principal, Role } from '@/lib/context/types'
import type { SpaceRepoRef } from '@/lib/context/service'
import { sql } from './client'

export interface SpaceRow {
  id: string
  slug: string
  name: string
  github_owner: string
  github_repo: string
  github_installation_id: string // bigint arrives as string over the wire
  default_branch: string
  current_sha: string | null
  write_back_default: 'auto_merge_clean' | 'proposal_only'
  status: 'active' | 'archived'
  created_by: string
}

export interface MemberRow {
  id: string
  space_id: string
  principal_type: Principal['type']
  principal_id: string
  role: Role
}

export async function createSpace(input: {
  slug: string
  name: string
  owner: string
  repo: string
  installationId: number
  currentSha: string
  createdBy: string
}): Promise<SpaceRow> {
  const rows = (await sql`
    insert into spaces (slug, name, github_owner, github_repo, github_installation_id, current_sha, created_by)
    values (${input.slug}, ${input.name}, ${input.owner}, ${input.repo}, ${input.installationId}, ${input.currentSha}, ${input.createdBy})
    returning *
  `) as SpaceRow[]
  const row = rows[0]
  if (!row) throw new Error('createSpace: insert returned no row')
  return row
}

export async function getSpaceById(id: string): Promise<SpaceRow | null> {
  const rows = (await sql`select * from spaces where id = ${id}`) as SpaceRow[]
  return rows[0] ?? null
}

export async function loadSpaceRepo(id: string): Promise<SpaceRepoRef> {
  const space = await getSpaceById(id)
  if (!space) throw new Error(`space not found: ${id}`)
  return { owner: space.github_owner, repo: space.github_repo, defaultBranch: space.default_branch }
}

export async function addMember(
  spaceId: string,
  principalType: Principal['type'],
  principalId: string,
  role: Role,
  createdBy: string,
): Promise<MemberRow> {
  const rows = (await sql`
    insert into space_members (space_id, principal_type, principal_id, role, created_by)
    values (${spaceId}, ${principalType}, ${principalId}, ${role}, ${createdBy})
    on conflict (space_id, principal_type, principal_id) do update set role = excluded.role
    returning id, space_id, principal_type, principal_id, role
  `) as MemberRow[]
  const row = rows[0]
  if (!row) throw new Error('addMember: upsert returned no row')
  return row
}

export const getMemberRole: MemberLookup = async (spaceId, principalType, principalId) => {
  const rows = (await sql`
    select role from space_members
    where space_id = ${spaceId} and principal_type = ${principalType} and principal_id = ${principalId}
  `) as { role: Role }[]
  return rows[0]?.role ?? null
}

export async function findTokenByPrefix(prefix: string): Promise<TokenRow | null> {
  const rows = (await sql`
    select id, space_id, token_hash, role, expires_at, revoked_at
    from api_tokens where token_prefix = ${prefix}
  `) as TokenRow[]
  return rows[0] ?? null
}

export async function insertAudit(entry: {
  spaceId: string | null
  actorType: string
  actorId?: string | null
  actorDisplay?: string | null
  action: string
  path?: string | null
  baseSha?: string | null
  resultSha?: string | null
  outcome: 'ok' | 'conflict' | 'denied' | 'error'
  requestId?: string | null
}): Promise<void> {
  await sql`
    insert into audit_log (space_id, actor_type, actor_id, actor_display, action, path, base_sha, result_sha, outcome, request_id)
    values (${entry.spaceId}, ${entry.actorType}, ${entry.actorId ?? null}, ${entry.actorDisplay ?? null},
            ${entry.action}, ${entry.path ?? null}, ${entry.baseSha ?? null}, ${entry.resultSha ?? null},
            ${entry.outcome}, ${entry.requestId ?? null})
  `
}
