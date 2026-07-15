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

export async function getSpaceBySlug(slug: string): Promise<SpaceRow | null> {
  const rows = (await sql`select * from spaces where slug = ${slug}`) as SpaceRow[]
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
    select id, space_id, token_hash, role, user_id, proposal_only, expires_at, revoked_at
    from api_tokens where token_prefix = ${prefix}
  `) as TokenRow[]
  return rows[0] ?? null
}

export async function insertApiToken(input: {
  spaceId: string
  name: string
  tokenPrefix: string
  tokenHash: string
  /** null for a member-owned token (role follows the member); set for a service token. */
  role: 'reader' | 'editor' | null
  /** set when the token belongs to a member (its role follows their membership). */
  userId?: string | null
  /** opt-in: this token's writes open a PR instead of auto-merging. */
  proposalOnly?: boolean
  createdBy: string
  expiresAt?: string | null
}): Promise<{ id: string }> {
  const rows = (await sql`
    insert into api_tokens (space_id, name, token_prefix, token_hash, role, user_id, proposal_only, created_by, expires_at)
    values (${input.spaceId}, ${input.name}, ${input.tokenPrefix}, ${input.tokenHash}, ${input.role ?? null},
            ${input.userId ?? null}, ${input.proposalOnly ?? false}, ${input.createdBy}, ${input.expiresAt ?? null})
    returning id
  `) as { id: string }[]
  const row = rows[0]
  if (!row) throw new Error('insertApiToken: insert returned no row')
  return row
}

/** The proposal_only flag for a token (write-back policy). */
export async function getTokenProposalOnly(tokenId: string): Promise<boolean> {
  const rows = (await sql`select proposal_only from api_tokens where id = ${tokenId}`) as { proposal_only: boolean }[]
  return rows[0]?.proposal_only ?? false
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
 *
 * `highlight` is a per-query excerpt with matched terms wrapped in ** (via
 * ts_headline). It runs over the stored 200-char `snippet`, NOT the document
 * body — the body deliberately never lands in Neon (§2.2 blast radius), so a
 * match that lives deeper than the snippet highlights nothing (see the search
 * route note / ARCHITECTURE §7.3 for the bounded-headline-source upgrade path).
 */
export async function searchDocuments(spaceId: string, query: string, limit = 20): Promise<SearchHit[]> {
  const rows = (await sql`
    select path, title, snippet,
      ts_headline(
        'english', coalesce(snippet, ''), websearch_to_tsquery('english', ${query}),
        'StartSel=**, StopSel=**, MaxFragments=1, MaxWords=25, MinWords=8'
      ) as highlight
    from documents
    where space_id = ${spaceId} and fts @@ websearch_to_tsquery('english', ${query})
    order by ts_rank(fts, websearch_to_tsquery('english', ${query})) desc
    limit ${limit}
  `) as { path: string; title: string | null; snippet: string | null; highlight: string | null }[]
  return rows.map((r) => ({
    path: r.path,
    title: r.title ?? undefined,
    snippet: r.snippet ?? undefined,
    highlight: r.highlight ?? undefined,
  }))
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
  // The engine's write outcome ('proposal' | 'conflict') maps to the proposals
  // table's lifecycle status: a proposal_only PR is 'open'; a conflict PR is
  // 'conflict'. Both are "awaiting a human" (listOpenProposals selects both).
  // 'proposal' is NOT a valid proposals.status — inserting it verbatim violates
  // the CHECK constraint. (Caught by the DB integration test, not the mocks.)
  const dbStatus = input.status === 'conflict' ? 'conflict' : 'open'
  const rows = (await sql`
    insert into proposals (space_id, actor_display, path, base_sha, branch_ref, pr_number, pr_url, status)
    values (${input.spaceId}, ${input.actorDisplay}, ${input.path}, ${input.baseSha}, ${input.branchRef},
            ${input.prNumber}, ${input.prUrl}, ${dbStatus})
    returning id
  `) as { id: string }[]
  const row = rows[0]
  if (!row) throw new Error('recordProposal: insert returned no row')
  return row.id
}

/** Liveness/readiness probe: throws if the DB is unreachable. */
export async function ping(): Promise<void> {
  await sql`select 1`
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

// ---- dashboard read models (control-plane UI) ----

export interface MemberListRow {
  id: string
  principal_type: Principal['type']
  principal_id: string
  role: Role
  created_by: string
  created_at: string
}

export async function listMembers(spaceId: string): Promise<MemberListRow[]> {
  return (await sql`
    select id, principal_type, principal_id, role, created_by, created_at
    from space_members where space_id = ${spaceId}
    order by case role when 'admin' then 0 when 'editor' then 1 else 2 end, created_at
  `) as MemberListRow[]
}

export async function removeMember(spaceId: string, memberId: string): Promise<boolean> {
  const rows = (await sql`
    delete from space_members where id = ${memberId} and space_id = ${spaceId} returning id
  `) as { id: string }[]
  return rows.length > 0
}

export interface TokenMetaRow {
  id: string
  name: string
  role: 'reader' | 'editor' | null
  user_id: string | null
  proposal_only: boolean
  token_prefix: string
  created_by: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  expires_at: string | null
}

/** Token metadata for the UI — NEVER the hash or plaintext. */
export async function listTokensMeta(spaceId: string): Promise<TokenMetaRow[]> {
  return (await sql`
    select id, name, role, user_id, proposal_only, token_prefix, created_by, created_at,
           last_used_at, revoked_at, expires_at
    from api_tokens where space_id = ${spaceId}
    order by created_at desc
  `) as TokenMetaRow[]
}

export interface AuditRow {
  id: string
  ts: string
  actor_type: string
  actor_id: string | null
  actor_display: string | null
  action: string
  path: string | null
  outcome: string
}

export async function listRecentAudit(spaceId: string, limit = 50): Promise<AuditRow[]> {
  return (await sql`
    select id, ts, actor_type, actor_id, actor_display, action, path, outcome
    from audit_log where space_id = ${spaceId}
    order by ts desc limit ${limit}
  `) as AuditRow[]
}

export interface ActivityStats {
  current_sha: string | null
  last_updated: string | null
  writes_7d: number
  docs: number
  open_proposals: number
}

export interface PendingInvite {
  id: string
  space_id: string
  email: string
  role: 'admin' | 'editor' | 'reader'
  invited_by: string
  created_at: string
}

/** Upsert a pending email invitation (re-inviting the same email updates the role). */
export async function createPendingInvitation(input: {
  spaceId: string
  email: string
  role: 'admin' | 'editor' | 'reader'
  invitedBy: string
  clerkInvitationId?: string | null
}): Promise<{ id: string }> {
  const rows = (await sql`
    insert into pending_invitations (space_id, email, role, invited_by, clerk_invitation_id)
    values (${input.spaceId}, ${input.email.toLowerCase()}, ${input.role}, ${input.invitedBy}, ${input.clerkInvitationId ?? null})
    on conflict (space_id, email) do update set
      role = excluded.role, invited_by = excluded.invited_by, clerk_invitation_id = excluded.clerk_invitation_id
    returning id
  `) as { id: string }[]
  const row = rows[0]
  if (!row) throw new Error('createPendingInvitation: insert returned no row')
  return row
}

export async function listPendingInvitations(spaceId: string): Promise<PendingInvite[]> {
  return (await sql`
    select id, space_id, email, role, invited_by, created_at
    from pending_invitations where space_id = ${spaceId} order by created_at desc
  `) as PendingInvite[]
}

export async function cancelPendingInvitation(spaceId: string, id: string): Promise<boolean> {
  const rows = (await sql`delete from pending_invitations where id = ${id} and space_id = ${spaceId} returning id`) as { id: string }[]
  return rows.length > 0
}

/** All pending invites for an email (across spaces) — used to reconcile on login. */
export async function listPendingForEmail(email: string): Promise<PendingInvite[]> {
  return (await sql`
    select id, space_id, email, role, invited_by, created_at
    from pending_invitations where lower(email) = ${email.toLowerCase()}
  `) as PendingInvite[]
}

export async function deletePendingInvitationById(id: string): Promise<void> {
  await sql`delete from pending_invitations where id = ${id}`
}

/** Per-project activity summary for the dashboard overview. */
export async function getActivityStats(spaceId: string): Promise<ActivityStats> {
  const rows = (await sql`
    select
      (select current_sha from spaces where id = ${spaceId}) as current_sha,
      (select updated_at from spaces where id = ${spaceId}) as last_updated,
      (select count(*)::int from audit_log
         where space_id = ${spaceId}
           and action in ('cas_write','merge','delete','move','reindex','backfill')
           and ts > now() - interval '7 days') as writes_7d,
      (select count(*)::int from documents where space_id = ${spaceId}) as docs,
      (select count(*)::int from proposals
         where space_id = ${spaceId} and status in ('open','conflict')) as open_proposals
  `) as ActivityStats[]
  return rows[0] ?? { current_sha: null, last_updated: null, writes_7d: 0, docs: 0, open_proposals: 0 }
}
