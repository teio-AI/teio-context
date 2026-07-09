import * as db from '@/db'
import type { GitHubApi } from '../github/client'
import { getBlobContent, getContentAtRef, getTreeBlobs, type RepoRef } from '../github/git-data'

const SNIPPET_LEN = 200

/** Only markdown under context/ is indexed for search (space.yaml etc. are not). */
export function isIndexable(path: string): boolean {
  return path.startsWith('context/') && path.endsWith('.md')
}

export function titleAndSnippet(content: string): { title: string | null; snippet: string } {
  const heading = content.match(/^#{1,6}\s+(.+)$/m)
  const firstLine = content.split('\n').find((l) => l.trim().length > 0)
  const title = (heading?.[1] ?? firstLine ?? '').trim().slice(0, 200) || null
  const snippet = content.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN)
  return { title, snippet }
}

/**
 * Reindex a known set of changed paths (the webhook-push path — GitHub tells us
 * added/modified/removed). Non-indexable paths are ignored; a modified path
 * that vanished by the time we fetch is treated as a delete.
 */
export async function reindexChangedPaths(
  gh: GitHubApi,
  repo: RepoRef,
  spaceId: string,
  changed: { upserted: string[]; removed: string[] },
  commitSha: string,
): Promise<{ indexed: number; removed: number }> {
  let indexed = 0
  let removed = 0

  for (const path of changed.removed.filter(isIndexable)) {
    await db.deleteDocument(spaceId, path)
    removed++
  }

  for (const path of changed.upserted.filter(isIndexable)) {
    const file = await getContentAtRef(gh, repo, path, commitSha)
    if (!file) {
      await db.deleteDocument(spaceId, path)
      removed++
      continue
    }
    const { title, snippet } = titleAndSnippet(file.content)
    await db.upsertDocument({ spaceId, path, title, snippet, body: file.content, contentSha: file.sha, commitSha })
    indexed++
  }

  return { indexed, removed }
}

/**
 * Full reindex from the tree at `commitSha` (the backfill path, when we have no
 * per-file diff). Reindexes every indexable file and prunes documents whose
 * path is no longer present. `truncated` signals GitHub capped the tree — a
 * very large space would need a paginated walk (flagged, not silently wrong).
 */
export async function reindexAll(
  gh: GitHubApi,
  repo: RepoRef,
  spaceId: string,
  commitSha: string,
): Promise<{ indexed: number; removed: number; truncated: boolean }> {
  const { blobs, truncated } = await getTreeBlobs(gh, repo, commitSha)
  const indexable = blobs.filter((b) => isIndexable(b.path))
  const present = new Set(indexable.map((b) => b.path))

  let indexed = 0
  for (const blob of indexable) {
    const content = await getBlobContent(gh, repo, blob.sha)
    const { title, snippet } = titleAndSnippet(content)
    await db.upsertDocument({ spaceId, path: blob.path, title, snippet, body: content, contentSha: blob.sha, commitSha })
    indexed++
  }

  let removed = 0
  for (const path of await db.listDocumentPaths(spaceId)) {
    if (!present.has(path)) {
      await db.deleteDocument(spaceId, path)
      removed++
    }
  }

  return { indexed, removed, truncated }
}
