import { GitHubError, UnknownBaseError } from '../errors'
import type { GitHubApi } from './client'
import { encodeContentsPath } from './paths'

export interface RepoRef {
  owner: string
  repo: string
  branch: string
}

export interface Identity {
  name: string
  email: string
}

export interface TreeEntry {
  path: string
  mode: string
  type: 'blob'
  sha: string | null // null deletes the path relative to base_tree
}

export const BLOB_MODE = '100644'

/**
 * Raw Git Data + Merges API primitives (ARCHITECTURE §3.2). No policy, no
 * retry — those live one layer up (write-engine.ts's state machine, or
 * import.ts's bulk-seed flow). Shared so both consumers hit GitHub the exact
 * same way instead of duplicating request shapes.
 */

export async function getBranchHead(gh: GitHubApi, repo: RepoRef): Promise<string> {
  try {
    const res = await gh.request<{ object: { sha: string } }>('GET', `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${repo.branch}`)
    return res.data.object.sha
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) throw new UnknownBaseError()
    throw err
  }
}

export async function getCommitTree(gh: GitHubApi, repo: RepoRef, commitSha: string): Promise<string> {
  try {
    const res = await gh.request<{ tree: { sha: string } }>('GET', `/repos/${repo.owner}/${repo.repo}/git/commits/${commitSha}`)
    return res.data.tree.sha
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) throw new UnknownBaseError()
    throw err
  }
}

export async function getBlobSha(gh: GitHubApi, repo: RepoRef, path: string, ref: string): Promise<string | null> {
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

export async function createBlob(gh: GitHubApi, repo: RepoRef, content: string): Promise<string> {
  const res = await gh.request<{ sha: string }>('POST', `/repos/${repo.owner}/${repo.repo}/git/blobs`, {
    content,
    encoding: 'utf-8',
  })
  return res.data.sha
}

export async function createTree(gh: GitHubApi, repo: RepoRef, baseTree: string, tree: TreeEntry[]): Promise<string> {
  const res = await gh.request<{ sha: string }>('POST', `/repos/${repo.owner}/${repo.repo}/git/trees`, {
    base_tree: baseTree,
    tree,
  })
  return res.data.sha
}

export async function createCommit(
  gh: GitHubApi,
  repo: RepoRef,
  body: { message: string; tree: string; parents: string[]; author: Identity; committer: Identity },
): Promise<string> {
  const res = await gh.request<{ sha: string }>('POST', `/repos/${repo.owner}/${repo.repo}/git/commits`, body)
  return res.data.sha
}

/**
 * POST /merges — GitHub's server-side 3-way merge. Raw status mapping only:
 * 201 merged (sha present) · 204 already-merged (empty body — caller must
 * re-resolve HEAD, never treat as a new sha) · 409 real conflict · 404 a
 * race (base/head vanished). Retry/PR-on-conflict policy is the caller's job.
 */
export interface TreeBlob {
  path: string
  sha: string
}

/** Recursive tree listing at a commit — blobs only. `truncated` when GitHub capped it. */
export async function getTreeBlobs(gh: GitHubApi, repo: RepoRef, commitSha: string): Promise<{ blobs: TreeBlob[]; truncated: boolean }> {
  const treeSha = await getCommitTree(gh, repo, commitSha)
  const res = await gh.request<{ tree: { path: string; type: string; sha: string }[]; truncated: boolean }>(
    'GET',
    `/repos/${repo.owner}/${repo.repo}/git/trees/${treeSha}?recursive=1`,
  )
  const blobs = res.data.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha }))
  return { blobs, truncated: res.data.truncated }
}

/** Decoded UTF-8 content of a blob by its sha. */
export async function getBlobContent(gh: GitHubApi, repo: RepoRef, blobSha: string): Promise<string> {
  const res = await gh.request<{ content: string; encoding: string }>('GET', `/repos/${repo.owner}/${repo.repo}/git/blobs/${blobSha}`)
  return Buffer.from(res.data.content, (res.data.encoding as BufferEncoding) || 'base64').toString('utf8')
}

/** Decoded content of a path at a ref, or null if it doesn't exist there. */
export async function getContentAtRef(gh: GitHubApi, repo: RepoRef, path: string, ref: string): Promise<{ content: string; sha: string } | null> {
  try {
    const res = await gh.request<{ content: string; encoding: string; sha: string }>(
      'GET',
      `/repos/${repo.owner}/${repo.repo}/contents/${encodeContentsPath(path)}?ref=${encodeURIComponent(ref)}`,
    )
    return { content: Buffer.from(res.data.content, (res.data.encoding as BufferEncoding) || 'base64').toString('utf8'), sha: res.data.sha }
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null
    throw err
  }
}

export async function mergeBranch(gh: GitHubApi, repo: RepoRef, head: string, message: string): Promise<{ status: number; sha?: string }> {
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
