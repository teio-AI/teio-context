import type { GitHubApi } from '../github/client'
import { createBlob, createCommit, createTree, getBranchHead, getCommitTree, mergeBranch, type Identity, type RepoRef } from '../github/git-data'
import { AppError } from '../errors'
import { validateContent } from './write-engine'

export interface ImportFile {
  path: string
  content: string
}

export interface ImportOutcome {
  sha: string
  fileCount: number
}

/** Avoid an oversized single tree payload; also caps blob-creation concurrency per batch. */
export const IMPORT_CHUNK_SIZE = 50
export const MAX_IMPORT_FILES = 500

export class ImportConflictError extends AppError {
  constructor() {
    super('import conflicted with a concurrent write; re-run the import', 'import_conflict', 409)
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Seed a space's context/ from a caller-supplied file set: one commit, built
 * incrementally across chunked tree-creation calls so a large import never
 * sends an oversized single tree payload or bursts the secondary
 * content-creation rate limit in one shot (ARCHITECTURE §7.1, finding #13).
 *
 * Runs as a single admin bulk-seed op, not through WriteEngine's per-file
 * CAS/retry state machine — that machine exists to resolve *concurrent*
 * writers on one file, which isn't the shape of a bulk import. Landing still
 * goes through the same server-side 3-way merge (mergeBranch) as a normal
 * write, so a genuine concurrent edit during import is a conflict, not a
 * silent clobber — it just doesn't get retried or turned into a PR; the
 * caller re-runs the import.
 */
export async function seedFiles(gh: GitHubApi, repo: RepoRef, files: ImportFile[], identity: { author: Identity; committer: Identity }): Promise<ImportOutcome> {
  for (const f of files) validateContent(f.content)

  const baseSha = await getBranchHead(gh, repo)
  let treeSha = await getCommitTree(gh, repo, baseSha)

  for (const batch of chunk(files, IMPORT_CHUNK_SIZE)) {
    const entries = await Promise.all(
      batch.map(async (f) => ({ path: f.path, mode: '100644', type: 'blob' as const, sha: await createBlob(gh, repo, f.content) })),
    )
    treeSha = await createTree(gh, repo, treeSha, entries)
  }

  const commitSha = await createCommit(gh, repo, {
    message: `discover: import ${files.length} file(s)`,
    tree: treeSha,
    parents: [baseSha],
    author: identity.author,
    committer: identity.committer,
  })

  const merge = await mergeBranch(gh, repo, commitSha, `discover: import ${files.length} file(s)`)
  if (merge.status === 204) return { sha: await getBranchHead(gh, repo), fileCount: files.length }
  if (merge.status < 400) return { sha: merge.sha!, fileCount: files.length }
  throw new ImportConflictError()
}
