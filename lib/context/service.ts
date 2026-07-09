import { GitHubError, NotFoundError, NotImplementedError } from '../errors'
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
  /** Spaces a principal can see: the Neon space_members join (users) or the token's own binding. */
  listSpacesForPrincipal(principal: Principal): Promise<SpaceSummary[]>
  /** Postgres FTS over the derived `documents` index (tsvector + snippet, not full bodies). */
  searchDocuments(spaceId: string, query: string): Promise<SearchHit[]>
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

/**
 * Phase 1 established the read path (getVersion, getDocument) and the write
 * path skeleton (NotImplementedError). Phase 2 adds: listSpaces, search (via
 * the derived FTS index, not GitHub), and dedupes getDocument's GitHub calls
 * (it previously called getVersion internally, doubling loadSpaceRepo +
 * clientFor + the ref lookup for every document read).
 */
export class GitContextService implements ContextService {
  constructor(private readonly deps: ContextServiceDeps) {}

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

    // Content (blob) and version (branch head) are independent GitHub calls —
    // run them concurrently instead of the Phase 1 pattern of calling
    // getVersion() as a nested, fully-redundant loadSpaceRepo+clientFor+fetch.
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
