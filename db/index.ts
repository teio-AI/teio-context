import type { MemberLookup } from '@/lib/auth/authorize'
import type { TokenRow } from '@/lib/auth/principal'
import type { Principal, Role, SearchHit, SpaceSummary } from '@/lib/context/types'
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

export async function touchTokenLastUsed(tokenId: string): Promise<void> {
  await sql`update api_tokens set last_used_at = now() where id = ${tokenId}`
}

/** Spaces a Clerk user is a member of (share OUT: GET /api/spaces). */
export async function listSpacesForUser(userId: string): Promise<SpaceSummary[]> {
  const rows = (await sql`
    select s.id, s.slug, s.name, sm.role
    from spaces s
    join space_members sm on sm.space_id = s.id
    where sm.principal_type = 'user' and sm.principal_id = ${userId} and s.status = 'active'
    order by s.name
  `) as SpaceSummary[]
  return rows
}

/**
 * The single space a machine token can see — its own binding (api_tokens.space_id
 * + role), not a space_members lookup (tokens are not mirrored into that table;
 * see lib/auth/context.ts for why: one source of truth, no drift).
 */
export async function listSpacesForToken(tokenId: string): Promise<SpaceSummary[]> {
  const rows = (await sql`
    select s.id, s.slug, s.name, t.role
    from api_tokens t
    join spaces s on s.id = t.space_id
    where t.id = ${tokenId} and t.revoked_at is null and s.status = 'active'
  `) as SpaceSummary[]
  return rows
}

/**
 * Postgres FTS over the derived `documents` index (ARCHITECTURE §7.3).
 * `websearch_to_tsquery` accepts free-text query syntax (quotes, -exclude, OR).
 */
export async function searchDocuments(spaceId: string, query: string, limit = 20): Promise<SearchHit[]> {
  const rows = (await sql`
    select path, title, snippet
    from documents
    where space_id = ${spaceId} and fts @@ websearch_to_tsquery('english', ${query})
    order by ts_rank(fts, websearch_to_tsquery('english', ${query})) desc
    limit ${limit}
  `) as { path: string; title: string | null; snippet: string | null }[]
  return rows.map((r) => ({ path: r.path, title: r.title ?? undefined, snippet: r.snippet ?? undefined }))
}

export async function setCurrentSha(spaceId: string, sha: string): Promise<void> {
  await sql`update spaces set current_sha = ${sha}, updated_at = now() where id = ${spaceId}`
}

export async function recordProposal(input: {
  spaceId: string
  actorDisplay: string
  path: string
  baseSha: string
  branchRef: string
  prNumber: number
  prUrl: string
  status: 'proposal' | 'conflict'
}): Promise<string> {
  const rows = (await sql`
    insert into proposals (space_id, actor_display, path, base_sha, branch_ref, pr_number, pr_url, status)
    values (${input.spaceId}, ${input.actorDisplay}, ${input.path}, ${input.baseSha}, ${input.branchRef},
            ${input.prNumber}, ${input.prUrl}, ${input.status})
    returning id
  `) as { id: string }[]
  const row = rows[0]
  if (!row) throw new Error('recordProposal: insert returned no row')
  return row.id
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
