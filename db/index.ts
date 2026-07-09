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
    select id, space_id, token_hash, role, connector_id, expires_at, revoked_at
    from api_tokens where token_prefix = ${prefix}
  `) as TokenRow[]
  return rows[0] ?? null
}

export async function insertApiToken(input: {
  spaceId: string
  name: string
  tokenPrefix: string
  tokenHash: string
  role: 'reader' | 'editor'
  connectorId?: string | null
  createdBy: string
  expiresAt?: string | null
}): Promise<{ id: string }> {
  const rows = (await sql`
    insert into api_tokens (space_id, name, token_prefix, token_hash, role, connector_id, created_by, expires_at)
    values (${input.spaceId}, ${input.name}, ${input.tokenPrefix}, ${input.tokenHash}, ${input.role},
            ${input.connectorId ?? null}, ${input.createdBy}, ${input.expiresAt ?? null})
    returning id
  `) as { id: string }[]
  const row = rows[0]
  if (!row) throw new Error('insertApiToken: insert returned no row')
  return row
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

export interface ConnectorRow {
  id: string
  space_id: string
  kind: 'mcp' | 'teio' | 'customer'
  name: string
  write_back_policy: 'auto_merge_clean' | 'proposal_only' | 'inherit'
  status: 'active' | 'disabled'
}

export async function createConnector(input: {
  spaceId: string
  kind: ConnectorRow['kind']
  name: string
  writeBackPolicy: ConnectorRow['write_back_policy']
}): Promise<ConnectorRow> {
  const rows = (await sql`
    insert into connectors (space_id, kind, name, write_back_policy)
    values (${input.spaceId}, ${input.kind}, ${input.name}, ${input.writeBackPolicy})
    returning id, space_id, kind, name, write_back_policy, status
  `) as ConnectorRow[]
  const row = rows[0]
  if (!row) throw new Error('createConnector: insert returned no row')
  return row
}

export async function getConnectorById(id: string): Promise<ConnectorRow | null> {
  const rows = (await sql`
    select id, space_id, kind, name, write_back_policy, status from connectors where id = ${id}
  `) as ConnectorRow[]
  return rows[0] ?? null
}

/**
 * The write-back policy for a token's bound connector, resolved ('inherit'
 * -> spaceDefault). null = the token has no connector (or it's disabled) —
 * caller falls through to the space default (ARCHITECTURE §3.1).
 */
export async function resolveConnectorPolicyForToken(
  tokenId: string,
  spaceDefault: ConnectorRow['write_back_policy'] & ('auto_merge_clean' | 'proposal_only'),
): Promise<'auto_merge_clean' | 'proposal_only' | null> {
  const rows = (await sql`
    select c.write_back_policy
    from api_tokens t
    join connectors c on c.id = t.connector_id
    where t.id = ${tokenId} and c.status = 'active'
  `) as { write_back_policy: ConnectorRow['write_back_policy'] }[]
  const policy = rows[0]?.write_back_policy
  if (!policy) return null
  return policy === 'inherit' ? spaceDefault : policy
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

// ---- freshness / operations (Phase 5) ----

export async function getSpaceByRepo(owner: string, repo: string): Promise<SpaceRow | null> {
  const rows = (await sql`
    select * from spaces where github_owner = ${owner} and github_repo = ${repo}
  `) as SpaceRow[]
  return rows[0] ?? null
}

export async function listActiveSpaces(): Promise<SpaceRow[]> {
  return (await sql`select * from spaces where status = 'active'`) as SpaceRow[]
}

/**
 * Upsert a document into the derived FTS index. `body` is used ONLY to compute
 * the tsvector server-side; it is never stored (ARCHITECTURE §2.2 blast-radius
 * note — the full corpus never lives in Neon).
 */
export async function upsertDocument(input: {
  spaceId: string
  path: string
  title: string | null
  snippet: string | null
  body: string
  contentSha: string
  commitSha: string
}): Promise<void> {
  await sql`
    insert into documents (space_id, path, title, snippet, fts, content_sha, commit_sha)
    values (${input.spaceId}, ${input.path}, ${input.title}, ${input.snippet},
            to_tsvector('english', ${input.body}), ${input.contentSha}, ${input.commitSha})
    on conflict (space_id, path) do update set
      title = excluded.title, snippet = excluded.snippet, fts = excluded.fts,
      content_sha = excluded.content_sha, commit_sha = excluded.commit_sha, updated_at = now()
  `
}

export async function deleteDocument(spaceId: string, path: string): Promise<void> {
  await sql`delete from documents where space_id = ${spaceId} and path = ${path}`
}

export async function listDocumentPaths(spaceId: string): Promise<string[]> {
  const rows = (await sql`select path from documents where space_id = ${spaceId}`) as { path: string }[]
  return rows.map((r) => r.path)
}

/** Mark every connector cursor for a space stale (its last-synced sha != new head). */
export async function markCursorsStale(spaceId: string): Promise<void> {
  await sql`
    update sync_cursors set status = 'stale'
    where connector_id in (select id from connectors where space_id = ${spaceId})
      and (last_synced_sha is distinct from (select current_sha from spaces where id = ${spaceId}))
  `
}

/** A consumer acks it has synced to `sha`; its cursor becomes current. */
export async function ackCursor(connectorId: string, sha: string): Promise<void> {
  await sql`
    insert into sync_cursors (connector_id, last_synced_sha, last_synced_at, status)
    values (${connectorId}, ${sha}, now(), 'current')
    on conflict (connector_id) do update set
      last_synced_sha = excluded.last_synced_sha, last_synced_at = now(), status = 'current'
  `
}

export interface ProposalRow {
  id: string
  space_id: string
  path: string
  branch_ref: string
  pr_number: number | null
  pr_url: string | null
  status: 'open' | 'merged' | 'closed' | 'conflict'
}

export async function listOpenProposals(spaceId: string): Promise<ProposalRow[]> {
  return (await sql`
    select id, space_id, path, branch_ref, pr_number, pr_url, status
    from proposals where space_id = ${spaceId} and status in ('open', 'conflict')
    order by created_at desc
  `) as ProposalRow[]
}

export async function resolveProposalByPr(
  spaceId: string,
  prNumber: number,
  status: 'merged' | 'closed',
): Promise<ProposalRow | null> {
  const rows = (await sql`
    update proposals set status = ${status}, resolved_at = now()
    where space_id = ${spaceId} and pr_number = ${prNumber} and status in ('open', 'conflict')
    returning id, space_id, path, branch_ref, pr_number, pr_url, status
  `) as ProposalRow[]
  return rows[0] ?? null
}

/** Record a webhook delivery; returns true if new (not seen before) → process it. */
export async function recordDelivery(deliveryId: string, event: string): Promise<boolean> {
  const rows = (await sql`
    insert into webhook_deliveries (delivery_id, event) values (${deliveryId}, ${event})
    on conflict (delivery_id) do nothing returning delivery_id
  `) as { delivery_id: string }[]
  return rows.length > 0
}

export async function getConnectorIdForToken(tokenId: string): Promise<string | null> {
  const rows = (await sql`select connector_id from api_tokens where id = ${tokenId}`) as { connector_id: string | null }[]
  return rows[0]?.connector_id ?? null
}

export async function revokeToken(spaceId: string, tokenId: string): Promise<boolean> {
  const rows = (await sql`
    update api_tokens set revoked_at = now()
    where id = ${tokenId} and space_id = ${spaceId} and revoked_at is null
    returning id
  `) as { id: string }[]
  return rows.length > 0
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
