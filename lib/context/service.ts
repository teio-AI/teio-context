import { NotImplementedError } from '../errors'
import type { GitHubApi } from '../github/client'
import type { ContextService, DocumentRead, Principal, ProposeInput, SearchHit, SpaceSummary, WriteResult } from './types'

export interface SpaceRepoRef {
  owner: string
  repo: string
  defaultBranch: string
}

export interface ContextServiceDeps {
  /** Resolve a space id to its GitHub coordinates (from the Neon registry). */
  loadSpaceRepo(spaceId: string): Promise<SpaceRepoRef>
  /** A GitHub client bound to the space's installation token. */
  clientFor(spaceId: string): Promise<GitHubApi>
}

/**
 * Phase 1 skeleton: the read path (getVersion, getDocument) is real; search and
 * the write path throw NotImplementedError until Phases 2-3. The interface is
 * complete so adapters can be written against it now.
 */
export class GitContextService implements ContextService {
  constructor(private readonly deps: ContextServiceDeps) {}

  async listSpaces(_principal: Principal): Promise<SpaceSummary[]> {
    // Backed by the Neon space_members join; wired in Phase 2.
    throw new NotImplementedError('listSpaces', 'Phase 2')
  }

  async getVersion(_principal: Principal, spaceId: string): Promise<{ sha: string; updatedAt: string }> {
    const { owner, repo, defaultBranch } = await this.deps.loadSpaceRepo(spaceId)
    const gh = await this.deps.clientFor(spaceId)
    const ref = await gh.request<{ object: { sha: string } }>(
      'GET',
      `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`,
    )
    return { sha: ref.data.object.sha, updatedAt: new Date().toISOString() }
  }

  async getDocument(principal: Principal, spaceId: string, path: string): Promise<DocumentRead> {
    const { owner, repo, defaultBranch } = await this.deps.loadSpaceRepo(spaceId)
    const gh = await this.deps.clientFor(spaceId)
    const res = await gh.request<{ content: string; encoding: string; sha: string }>(
      'GET',
      `/repos/${owner}/${repo}/contents/${encodeContentsPath(path)}?ref=${defaultBranch}`,
    )
    const content = Buffer.from(res.data.content, (res.data.encoding as BufferEncoding) || 'base64').toString('utf8')
    const version = await this.getVersion(principal, spaceId)
    return { path, content, version: version.sha, blob: res.data.sha }
  }

  async search(_principal: Principal, _spaceId: string, _query: string): Promise<SearchHit[]> {
    throw new NotImplementedError('search', 'Phase 2 (Postgres FTS)')
  }

  async listProposals(_principal: Principal, _spaceId: string): Promise<unknown[]> {
    throw new NotImplementedError('listProposals', 'Phase 3')
  }

  async proposeUpdate(_principal: Principal, _spaceId: string, _input: ProposeInput): Promise<WriteResult> {
    throw new NotImplementedError('proposeUpdate', 'Phase 3 (CAS fast path + 3-way merge)')
  }

  async deletePath(
    _principal: Principal,
    _spaceId: string,
    _input: { path: string; baseVersion?: string },
  ): Promise<WriteResult> {
    throw new NotImplementedError('deletePath', 'Phase 3')
  }

  async movePath(
    _principal: Principal,
    _spaceId: string,
    _input: { from: string; to: string; baseVersion?: string },
  ): Promise<WriteResult> {
    throw new NotImplementedError('movePath', 'Phase 3')
  }
}

/** Encode each path segment but keep the slashes (GitHub Contents API expects a path). */
export function encodeContentsPath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}
