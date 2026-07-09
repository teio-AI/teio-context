import { randomUUID } from 'node:crypto'
import { GitHubError, NotFoundError, UnknownBaseError, ValidationError } from '../errors'
import type { GitHubApi } from '../github/client'
import { encodeContentsPath } from '../github/paths'

export type WritePolicy = 'auto_merge_clean' | 'proposal_only'

export interface Identity {
  name: string
  email: string
}

export interface RepoRef {
  owner: string
  repo: string
  branch: string
}

/** The three mutations. `move` reuses the source blob (a true git rename), so no body. */
export type WriteChange =
  | { kind: 'upsert'; path: string; content: string }
  | { kind: 'delete'; path: string }
  | { kind: 'move'; from: string; to: string }

export interface WriteOptions {
  baseVersion?: string
  baseBlob?: string
  policy: WritePolicy
  author: Identity
  message?: string
}

export type EngineResult =
  | { status: 'merged'; version: string; viaFastPath: boolean }
  | { status: 'proposal' | 'conflict'; prNumber: number; prUrl: string; branchRef: string; headSha: string; baseSha: string }

export interface WriteEngineDeps {
  committer: Identity
  /** Injectable branch-name factory for deterministic tests. */
  newBranchName?: () => string
}

const MAX_CONTENT_BYTES = 1024 * 1024 // 1 MiB (ARCHITECTURE §7.4)
const MERGE_RETRY_MAX = 3
const BLOB_MODE = '100644'

interface TreeEntry {
  path: string
  mode: string
  type: 'blob'
  sha: string | null // null deletes the path relative to base_tree
}

/**
 * The write path (ARCHITECTURE §3.2). Pure GitHub orchestration — no DB, no
 * auth. Persistence (audit, current_sha, proposals) lives in GitContextService;
 * this class is injected a GitHubApi so tests exercise every branch against a
 * mock instead of hitting GitHub.
 *
 *   auto_merge_clean + upsert → CAS fast path (1 Contents PUT); on 409 (CAS
 *     miss) fall through to the 3-way path. 404/422 → unknown_base.
 *   3-way path (CAS miss, delete/move, or proposal_only):
 *     blob → tree(base_tree) → commit(parent=base). Then:
 *       proposal_only → open PR (even when it would merge clean)
 *       auto_merge_clean → POST /merges: 201 merged · 204 already-merged (do
 *         NOT write the empty body — re-resolve HEAD) · 409 conflict → PR ·
 *         404 race → retry ≤3 → unknown_base
 */
export class WriteEngine {
  constructor(private readonly deps: WriteEngineDeps) {}

  async write(gh: GitHubApi, repo: RepoRef, change: WriteChange, opts: WriteOptions): Promise<EngineResult> {
    if (change.kind === 'upsert') validateContent(change.content)

    if (opts.policy === 'auto_merge_clean' && change.kind === 'upsert') {
      const fast = await this.tryFastPath(gh, repo, change, opts)
      if (fast) return fast // else CAS miss → 3-way
    }
    return this.threeWay(gh, repo, change, opts)
  }

  // ---- CAS fast path (Contents API) ----

  private async tryFastPath(
    gh: GitHubApi,
    repo: RepoRef,
    change: { kind: 'upsert'; path: string; content: string },
    opts: WriteOptions,
  ): Promise<EngineResult | null> {
    const baseRef = opts.baseVersion ?? repo.branch
    const blobSha = opts.baseBlob ?? (await this.getBlobSha(gh, repo, change.path, baseRef)) ?? undefined

    const body: Record<string, unknown> = {
      message: opts.message ?? defaultMessage(change),
      content: Buffer.from(change.content, 'utf8').toString('base64'),
      branch: repo.branch,
      author: opts.author,
      committer: this.deps.committer,
    }
    if (blobSha !== undefined) body.sha = blobSha

    try {
      const res = await gh.request<{ commit: { sha: string } }>(
        'PUT',
        `/repos/${repo.owner}/${repo.repo}/contents/${encodeContentsPath(change.path)}`,
        body,
      )
      return { status: 'merged', version: res.data.commit.sha, viaFastPath: true }
    } catch (err) {
      if (err instanceof GitHubError) {
        if (err.status === 409) return null // CAS miss → caller falls to 3-way
        if (err.status === 404 || err.status === 422) throw new UnknownBaseError()
      }
      throw err
    }
  }

  // ---- 3-way path (Git Data + Merges API) ----

  private async threeWay(gh: GitHubApi, repo: RepoRef, change: WriteChange, opts: WriteOptions): Promise<EngineResult> {
    const baseSha = opts.baseVersion ?? (await this.getBranchHead(gh, repo))
    const baseTree = await this.getCommitTree(gh, repo, baseSha)
    const entries = await this.buildTreeEntries(gh, repo, change, baseSha)
    const treeSha = await this.createTree(gh, repo, baseTree, entries)
    const headSha = await this.createCommit(gh, repo, {
      message: opts.message ?? defaultMessage(change),
      tree: treeSha,
      parents: [baseSha],
      author: opts.author,
      committer: this.deps.committer,
    })

    if (opts.policy === 'proposal_only') {
      return this.openProposal(gh, repo, headSha, baseSha, 'proposal', change)
    }

    for (let attempt = 0; attempt < MERGE_RETRY_MAX; attempt++) {
      const merge = await this.mergeInto(gh, repo, headSha, opts.message ?? defaultMessage(change))
      if (merge.status === 204) {
        // Head already contained in main. The 204 body is EMPTY — must NOT be
        // treated as a new SHA (ARCHITECTURE §3.4). Re-resolve the real HEAD.
        return { status: 'merged', version: await this.getBranchHead(gh, repo), viaFastPath: false }
      }
      if (merge.status < 400) return { status: 'merged', version: merge.sha!, viaFastPath: false }
      if (merge.status === 409) return this.openProposal(gh, repo, headSha, baseSha, 'conflict', change)
      // 404 → base/head vanished in a race → retry against latest main
    }
    throw new UnknownBaseError()
  }

  private async buildTreeEntries(gh: GitHubApi, repo: RepoRef, change: WriteChange, baseSha: string): Promise<TreeEntry[]> {
    switch (change.kind) {
      case 'upsert': {
        const sha = await this.createBlob(gh, repo, change.content)
        return [{ path: change.path, mode: BLOB_MODE, type: 'blob', sha }]
      }
      case 'delete':
        return [{ path: change.path, mode: BLOB_MODE, type: 'blob', sha: null }]
      case 'move': {
        const fromSha = await this.getBlobSha(gh, repo, change.from, baseSha)
        if (fromSha == null) throw new NotFoundError(`source path not found: ${change.from}`)
        return [
          { path: change.from, mode: BLOB_MODE, type: 'blob', sha: null },
          { path: change.to, mode: BLOB_MODE, type: 'blob', sha: fromSha },
        ]
      }
    }
  }

  private async openProposal(
    gh: GitHubApi,
    repo: RepoRef,
    headSha: string,
    baseSha: string,
    status: 'proposal' | 'conflict',
    change: WriteChange,
  ): Promise<EngineResult> {
    const name = (this.deps.newBranchName ?? (() => `proposal/${randomUUID()}`))()
    const branchRef = name.startsWith('refs/heads/') ? name : `refs/heads/${name}`
    await gh.request('POST', `/repos/${repo.owner}/${repo.repo}/git/refs`, { ref: branchRef, sha: headSha })
    const pr = await gh.request<{ number: number; html_url: string }>('POST', `/repos/${repo.owner}/${repo.repo}/pulls`, {
      title: prTitle(change),
      head: branchRef.replace('refs/heads/', ''),
      base: repo.branch,
      body: prBody(change, status, baseSha),
    })
    return { status, prNumber: pr.data.number, prUrl: pr.data.html_url, branchRef, headSha, baseSha }
  }

  // ---- low-level GitHub calls ----

  private async mergeInto(gh: GitHubApi, repo: RepoRef, head: string, message: string): Promise<{ status: number; sha?: string }> {
    try {
      const res = await gh.request<{ sha: string } | null>('POST', `/repos/${repo.owner}/${repo.repo}/merges`, {
        base: repo.branch,
        head,
        commit_message: message,
      })
      if (res.status === 204) return { status: 204 }
      return { status: res.status, sha: (res.data as { sha: string }).sha }
    } catch (err) {
      if (err instanceof GitHubError && (err.status === 409 || err.status === 404)) return { status: err.status }
      throw err
    }
  }

  private async getBranchHead(gh: GitHubApi, repo: RepoRef): Promise<string> {
    try {
      const res = await gh.request<{ object: { sha: string } }>('GET', `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${repo.branch}`)
      return res.data.object.sha
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) throw new UnknownBaseError()
      throw err
    }
  }

  private async getCommitTree(gh: GitHubApi, repo: RepoRef, commitSha: string): Promise<string> {
    try {
      const res = await gh.request<{ tree: { sha: string } }>('GET', `/repos/${repo.owner}/${repo.repo}/git/commits/${commitSha}`)
      return res.data.tree.sha
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) throw new UnknownBaseError()
      throw err
    }
  }

  private async getBlobSha(gh: GitHubApi, repo: RepoRef, path: string, ref: string): Promise<string | null> {
    try {
      const res = await gh.request<{ sha: string }>(
        'GET',
        `/repos/${repo.owner}/${repo.repo}/contents/${encodeContentsPath(path)}?ref=${encodeURIComponent(ref)}`,
      )
      return res.data.sha
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return null
      throw err
    }
  }

  private async createBlob(gh: GitHubApi, repo: RepoRef, content: string): Promise<string> {
    const res = await gh.request<{ sha: string }>('POST', `/repos/${repo.owner}/${repo.repo}/git/blobs`, {
      content,
      encoding: 'utf-8',
    })
    return res.data.sha
  }

  private async createTree(gh: GitHubApi, repo: RepoRef, baseTree: string, tree: TreeEntry[]): Promise<string> {
    const res = await gh.request<{ sha: string }>('POST', `/repos/${repo.owner}/${repo.repo}/git/trees`, {
      base_tree: baseTree,
      tree,
    })
    return res.data.sha
  }

  private async createCommit(
    gh: GitHubApi,
    repo: RepoRef,
    body: { message: string; tree: string; parents: string[]; author: Identity; committer: Identity },
  ): Promise<string> {
    const res = await gh.request<{ sha: string }>('POST', `/repos/${repo.owner}/${repo.repo}/git/commits`, body)
    return res.data.sha
  }
}

export function validateContent(content: string): void {
  if (content.includes('\u0000')) throw new ValidationError('binary content is not allowed')
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new ValidationError('content exceeds the 1 MiB limit')
}

function defaultMessage(change: WriteChange): string {
  switch (change.kind) {
    case 'upsert':
      return `update ${change.path}`
    case 'delete':
      return `delete ${change.path}`
    case 'move':
      return `move ${change.from} → ${change.to}`
  }
}

function prTitle(change: WriteChange): string {
  return defaultMessage(change)
}

function prBody(change: WriteChange, status: 'proposal' | 'conflict', baseSha: string): string {
  const reason =
    status === 'conflict'
      ? 'Auto-merge hit a real conflict; resolve here.'
      : 'This connector uses proposal_only, so changes land via PR.'
  return `${reason}\n\nbase: \`${baseSha}\``
}
