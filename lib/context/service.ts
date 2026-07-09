import { NotImplementedError } from '../errors'
import type { GitHubApi } from '../github/client'
import { encodeContentsPath } from '../github/paths'
import { GitHubError, NotFoundError } from '../errors'
import { WriteEngine, type EngineResult, type Identity, type WriteChange, type WritePolicy } from './write-engine'
import type { ContextService, DocumentRead, Principal, ProposeInput, SearchHit, SpaceSummary, WriteResult } from './types'

export interface SpaceRepoRef {
  owner: string
  repo: string
  defaultBranch: string
}

export interface RecordProposalInput {
  spaceId: string
  actorDisplay: string
  path: string
  baseSha: string
  branchRef: string
  prNumber: number
  prUrl: string
  status: 'proposal' | 'conflict'
}

export interface AuditEntry {
  spaceId: string
  actorType: Principal['type']
  actorId: string
  action: string
  path: string | null
  baseSha?: string | null
  resultSha?: string | null
  outcome: 'ok' | 'conflict' | 'denied' | 'error'
}

export interface ContextServiceDeps {
  /** Resolve a space id to its GitHub coordinates (from the Neon registry). */
  loadSpaceRepo(spaceId: string): Promise<SpaceRepoRef>
  /** A GitHub client bound to the space's installation token. */
  clientFor(spaceId: string): Promise<GitHubApi>
  /** Spaces a principal can see: the Neon space_members join (users) or the token's own binding. */
  listSpacesForPrincipal(principal: Principal): Promise<SpaceSummary[]>
  /** Postgres FTS over the derived `documents` index (tsvector + snippet, not full bodies). */
  searchDocuments(spaceId: string, query: string): Promise<SearchHit[]>

  // --- write path (Phase 3-4) ---
  /**
   * Effective write-back policy: the principal's bound connector (if a
   * machine token issued for one) overrides the space default, resolved
   * server-side from stored identity — never caller-asserted (ARCHITECTURE §3.1).
   */
  resolveWritePolicy(spaceId: string, principal: Principal): Promise<WritePolicy>
  /** Persist the new main HEAD after a merged write (O(1) staleness). */
  setCurrentSha(spaceId: string, sha: string): Promise<void>
  /** Record a PR-backed proposal (proposal_only or conflict). Returns the proposal id. */
  recordProposal(input: RecordProposalInput): Promise<string>
  /** Authoritative attribution + operability record (ARCHITECTURE §6). */
  audit(entry: AuditEntry): Promise<void>
  /** The GitHub App bot identity stamped as commit committer. */
  botCommitter: Identity
  /** Injectable branch-name factory (deterministic tests). */
  newBranchName?: () => string
}

/** Translate a GitHub 404 into our own NotFoundError; anything else rethrows unchanged. */
async function translateGitHub404<T>(promise: Promise<T>, message: string): Promise<T> {
  try {
    return await promise
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) throw new NotFoundError(message)
    throw err
  }
}

/** Stamp the real actor as the git author (audit_log remains the authoritative record). */
export function authorFor(principal: Principal): Identity {
  return { name: principal.display ?? principal.id, email: `${principal.id}@users.noreply.teio-context` }
}

/**
 * The read path (Phase 1-2) plus the write path (Phase 3). Writes delegate to
 * WriteEngine for GitHub orchestration; this class owns the DB side effects
 * (current_sha, proposals, audit) so the engine stays pure and testable.
 */
export class GitContextService implements ContextService {
  private readonly engine: WriteEngine

  constructor(private readonly deps: ContextServiceDeps) {
    this.engine = new WriteEngine({ committer: deps.botCommitter, newBranchName: deps.newBranchName })
  }

  async listSpaces(principal: Principal): Promise<SpaceSummary[]> {
    return this.deps.listSpacesForPrincipal(principal)
  }

  async getVersion(_principal: Principal, spaceId: string): Promise<{ sha: string; updatedAt: string }> {
    const { owner, repo, defaultBranch } = await this.deps.loadSpaceRepo(spaceId)
    const gh = await this.deps.clientFor(spaceId)
    const ref = await translateGitHub404(
      gh.request<{ object: { sha: string } }>('GET', `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`),
      'space repo or default branch not found',
    )
    return { sha: ref.data.object.sha, updatedAt: new Date().toISOString() }
  }

  async getDocument(_principal: Principal, spaceId: string, path: string): Promise<DocumentRead> {
    const { owner, repo, defaultBranch } = await this.deps.loadSpaceRepo(spaceId)
    const gh = await this.deps.clientFor(spaceId)

    const [contentRes, refRes] = await Promise.all([
      translateGitHub404(
        gh.request<{ content: string; encoding: string; sha: string }>(
          'GET',
          `/repos/${owner}/${repo}/contents/${encodeContentsPath(path)}?ref=${defaultBranch}`,
        ),
        `path not found: ${path}`,
      ),
      translateGitHub404(
        gh.request<{ object: { sha: string } }>('GET', `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`),
        'space repo or default branch not found',
      ),
    ])

    const content = Buffer.from(contentRes.data.content, (contentRes.data.encoding as BufferEncoding) || 'base64').toString(
      'utf8',
    )
    return { path, content, version: refRes.data.object.sha, blob: contentRes.data.sha }
  }

  async search(_principal: Principal, spaceId: string, query: string): Promise<SearchHit[]> {
    return this.deps.searchDocuments(spaceId, query)
  }

  async listProposals(_principal: Principal, _spaceId: string): Promise<unknown[]> {
    throw new NotImplementedError('listProposals', 'Phase 5')
  }

  async proposeUpdate(principal: Principal, spaceId: string, input: ProposeInput): Promise<WriteResult> {
    return this.runWrite(
      principal,
      spaceId,
      { kind: 'upsert', path: input.path, content: input.content },
      { baseVersion: input.baseVersion, baseBlob: input.baseBlob },
      'upsert',
      input.path,
    )
  }

  async deletePath(principal: Principal, spaceId: string, input: { path: string; baseVersion?: string }): Promise<WriteResult> {
    return this.runWrite(
      principal,
      spaceId,
      { kind: 'delete', path: input.path },
      { baseVersion: input.baseVersion },
      'delete',
      input.path,
    )
  }

  async movePath(
    principal: Principal,
    spaceId: string,
    input: { from: string; to: string; baseVersion?: string },
  ): Promise<WriteResult> {
    return this.runWrite(
      principal,
      spaceId,
      { kind: 'move', from: input.from, to: input.to },
      { baseVersion: input.baseVersion },
      'move',
      `${input.from} → ${input.to}`,
    )
  }

  private async runWrite(
    principal: Principal,
    spaceId: string,
    change: WriteChange,
    base: { baseVersion?: string; baseBlob?: string },
    opKind: 'upsert' | 'delete' | 'move',
    auditPath: string,
  ): Promise<WriteResult> {
    const { owner, repo, defaultBranch } = await this.deps.loadSpaceRepo(spaceId)
    const gh = await this.deps.clientFor(spaceId)
    const policy = await this.deps.resolveWritePolicy(spaceId, principal)

    const result = await this.engine.write(
      gh,
      { owner, repo, branch: defaultBranch },
      change,
      { baseVersion: base.baseVersion, baseBlob: base.baseBlob, policy, author: authorFor(principal) },
    )
    return this.persist(principal, spaceId, auditPath, base.baseVersion, result, opKind)
  }

  private async persist(
    principal: Principal,
    spaceId: string,
    path: string,
    baseVersion: string | undefined,
    result: EngineResult,
    opKind: 'upsert' | 'delete' | 'move',
  ): Promise<WriteResult> {
    if (result.status === 'merged') {
      await this.deps.setCurrentSha(spaceId, result.version)
      const action = opKind === 'upsert' ? (result.viaFastPath ? 'cas_write' : 'merge') : opKind
      await this.deps.audit({
        spaceId,
        actorType: principal.type,
        actorId: principal.id,
        action,
        path,
        baseSha: baseVersion ?? null,
        resultSha: result.version,
        outcome: 'ok',
      })
      return { status: 'merged', version: result.version }
    }

    const proposalId = await this.deps.recordProposal({
      spaceId,
      actorDisplay: principal.display ?? principal.id,
      path,
      baseSha: result.baseSha,
      branchRef: result.branchRef,
      prNumber: result.prNumber,
      prUrl: result.prUrl,
      status: result.status,
    })
    await this.deps.audit({
      spaceId,
      actorType: principal.type,
      actorId: principal.id,
      action: result.status === 'conflict' ? 'conflict_pr' : 'propose',
      path,
      baseSha: result.baseSha,
      outcome: result.status === 'conflict' ? 'conflict' : 'ok',
    })
    return { status: result.status, prUrl: result.prUrl, proposalId }
  }
}

export { encodeContentsPath }
