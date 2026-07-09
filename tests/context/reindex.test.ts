import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  upsertDocument: vi.fn(async () => {}),
  deleteDocument: vi.fn(async () => {}),
  listDocumentPaths: vi.fn(async () => [] as string[]),
}))

import * as db from '@/db'
import { GitHubError } from '@/lib/errors'
import type { GitHubApi } from '@/lib/github/client'
import { isIndexable, reindexAll, reindexChangedPaths, titleAndSnippet } from '@/lib/context/reindex'

interface Stub {
  status: number
  data?: unknown
}
type Handler = (m: string, p: string) => Stub

function gh(handler: Handler): GitHubApi {
  return {
    request: async (method: string, path: string) => {
      const r = handler(method, path)
      if (r.status >= 400) throw new GitHubError(r.status, 'err', `${method} ${path}`)
      return { status: r.status, data: (r.data ?? null) as unknown }
    },
  } as unknown as GitHubApi
}

const REPO = { owner: 'teio', repo: 'teio-context-acme', branch: 'main' }
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

describe('isIndexable', () => {
  it('indexes only markdown under context/', () => {
    expect(isIndexable('context/a.md')).toBe(true)
    expect(isIndexable('context/x/y.md')).toBe(true)
    expect(isIndexable('space.yaml')).toBe(false)
    expect(isIndexable('context/a.txt')).toBe(false)
    expect(isIndexable('README.md')).toBe(false)
  })
})

describe('titleAndSnippet', () => {
  it('pulls the first markdown heading as title and collapses whitespace in the snippet', () => {
    const { title, snippet } = titleAndSnippet('# Billing\n\nHow we bill    customers.\n')
    expect(title).toBe('Billing')
    expect(snippet).toBe('# Billing How we bill customers.')
  })

  it('falls back to the first non-empty line when there is no heading', () => {
    expect(titleAndSnippet('just text\nmore').title).toBe('just text')
  })
})

describe('reindexChangedPaths', () => {
  it('upserts indexable added/modified, deletes removed, ignores non-indexable', async () => {
    vi.mocked(db.upsertDocument).mockClear()
    vi.mocked(db.deleteDocument).mockClear()
    const api = gh((_m, p) =>
      p.includes('/contents/') ? { status: 200, data: { content: b64('# Hi\nbody'), encoding: 'base64', sha: 'BLOB' } } : { status: 404 },
    )

    const res = await reindexChangedPaths(
      api,
      REPO,
      's1',
      { upserted: ['context/a.md', 'space.yaml', 'context/img.png'], removed: ['context/old.md', 'README.md'] },
      'SHA',
    )

    expect(res).toEqual({ indexed: 1, removed: 1 })
    expect(db.upsertDocument).toHaveBeenCalledTimes(1)
    expect(vi.mocked(db.upsertDocument).mock.calls[0]![0]).toMatchObject({ spaceId: 's1', path: 'context/a.md', title: 'Hi', contentSha: 'BLOB', commitSha: 'SHA' })
    expect(db.deleteDocument).toHaveBeenCalledWith('s1', 'context/old.md')
  })

  it('treats a modified-but-now-missing path as a delete', async () => {
    vi.mocked(db.upsertDocument).mockClear()
    vi.mocked(db.deleteDocument).mockClear()
    const api = gh(() => ({ status: 404 })) // getContentAtRef → null
    const res = await reindexChangedPaths(api, REPO, 's1', { upserted: ['context/gone.md'], removed: [] }, 'SHA')
    expect(res).toEqual({ indexed: 0, removed: 1 })
    expect(db.deleteDocument).toHaveBeenCalledWith('s1', 'context/gone.md')
  })
})

describe('reindexAll', () => {
  it('indexes every indexable blob and prunes documents no longer present', async () => {
    vi.mocked(db.upsertDocument).mockClear()
    vi.mocked(db.deleteDocument).mockClear()
    vi.mocked(db.listDocumentPaths).mockResolvedValueOnce(['context/a.md', 'context/stale.md'])

    const api = gh((_m, p) => {
      if (p.includes('/git/commits/')) return { status: 200, data: { tree: { sha: 'TREESHA' } } }
      if (p.includes('/git/trees/')) {
        return {
          status: 200,
          data: {
            truncated: false,
            tree: [
              { path: 'context/a.md', type: 'blob', sha: 'A' },
              { path: 'space.yaml', type: 'blob', sha: 'Y' },
              { path: 'context/sub', type: 'tree', sha: 'T' },
            ],
          },
        }
      }
      if (p.includes('/git/blobs/')) return { status: 200, data: { content: b64('# A'), encoding: 'base64' } }
      return { status: 404 }
    })

    const res = await reindexAll(api, REPO, 's1', 'SHA')

    expect(res).toEqual({ indexed: 1, removed: 1, truncated: false })
    expect(db.upsertDocument).toHaveBeenCalledTimes(1)
    expect(vi.mocked(db.upsertDocument).mock.calls[0]![0]).toMatchObject({ path: 'context/a.md' })
    expect(db.deleteDocument).toHaveBeenCalledWith('s1', 'context/stale.md') // pruned
  })
})
