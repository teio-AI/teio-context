import { describe, expect, it } from 'vitest'
import { GitHubError, ValidationError } from '@/lib/errors'
import type { GitHubApi } from '@/lib/github/client'
import { IMPORT_CHUNK_SIZE, ImportConflictError, seedFiles, type ImportFile } from '@/lib/context/import'

interface Stub {
  status: number
  data?: unknown
}
type Handler = (m: string, p: string, b?: unknown) => Stub
interface Call {
  method: string
  path: string
  body?: unknown
}

function router(routes: Record<string, Stub | Handler>): Handler {
  return (method, path, body) => {
    for (const key of Object.keys(routes)) {
      const idx = key.indexOf(' ')
      if (method === key.slice(0, idx) && path.includes(key.slice(idx + 1))) {
        const v = routes[key]!
        return typeof v === 'function' ? v(method, path, body) : v
      }
    }
    throw new Error(`no route for ${method} ${path}`)
  }
}

function fakeGh(handler: Handler): { api: GitHubApi; calls: Call[] } {
  const calls: Call[] = []
  let blobCounter = 0
  let treeCounter = 0
  const api = {
    request: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body })
      const r = handler(method, path, body)
      if (r.status >= 400) throw new GitHubError(r.status, 'err', `${method} ${path}`)
      // Give blobs/trees distinct shas so chunk-chaining is verifiable.
      let data = r.data
      if (path.includes('/git/blobs') && method === 'POST') data = { sha: `BLOB${++blobCounter}` }
      if (path.includes('/git/trees') && method === 'POST') data = { sha: `TREE${++treeCounter}` }
      return { status: r.status, data: (data ?? null) as unknown }
    },
  } as unknown as GitHubApi
  return { api, calls }
}

const REPO = { owner: 'teio', repo: 'teio-context-acme', branch: 'main' }
const identity = { author: { name: 'actor', email: 'a@x' }, committer: { name: 'bot', email: 'b@x' } }

const baseRoutes: Record<string, Stub> = {
  'GET /git/ref/heads/': { status: 200, data: { object: { sha: 'MAIN' } } },
  'GET /git/commits/': { status: 200, data: { tree: { sha: 'BASETREE' } } },
  'POST /git/blobs': { status: 201 }, // sha overridden by fakeGh's blobCounter
  'POST /git/trees': { status: 201 }, // sha overridden by fakeGh's treeCounter
  'POST /git/commits': { status: 201, data: { sha: 'COMMIT' } },
  'POST /merges': { status: 201, data: { sha: 'MERGED' } },
}

function files(n: number): ImportFile[] {
  return Array.from({ length: n }, (_, i) => ({ path: `context/f${i}.md`, content: `file ${i}` }))
}

describe('seedFiles', () => {
  it('small import: one tree call, one commit, one clean merge', async () => {
    const { api, calls } = fakeGh(router(baseRoutes))
    const res = await seedFiles(api, REPO, files(3), identity)

    expect(res).toEqual({ sha: 'MERGED', fileCount: 3 })
    expect(calls.filter((c) => c.path.includes('/git/blobs')).length).toBe(3)
    expect(calls.filter((c) => c.path.includes('/git/trees')).length).toBe(1)
    expect(calls.filter((c) => c.path.includes('/git/commits') && c.method === 'POST').length).toBe(1)
  })

  it('chunks tree creation and chains base_tree across chunks (no oversized single call)', async () => {
    const n = IMPORT_CHUNK_SIZE * 2 + 5 // spans 3 chunks
    const { api, calls } = fakeGh(router(baseRoutes))
    const res = await seedFiles(api, REPO, files(n), identity)

    expect(res.fileCount).toBe(n)
    const treeCalls = calls.filter((c) => c.path.includes('/git/trees') && c.method === 'POST')
    expect(treeCalls).toHaveLength(3)
    expect((treeCalls[0]!.body as { base_tree: string }).base_tree).toBe('BASETREE')
    expect((treeCalls[1]!.body as { base_tree: string }).base_tree).toBe('TREE1') // chained onto chunk 1's result
    expect((treeCalls[2]!.body as { base_tree: string }).base_tree).toBe('TREE2')
    // No single tree call carries more than IMPORT_CHUNK_SIZE entries.
    for (const c of treeCalls) {
      expect((c.body as { tree: unknown[] }).tree.length).toBeLessThanOrEqual(IMPORT_CHUNK_SIZE)
    }
  })

  it('204 already-merged → re-resolves HEAD instead of using the empty body', async () => {
    const { api, calls } = fakeGh(
      router({ ...baseRoutes, 'POST /merges': { status: 204 }, 'GET /git/ref/heads/': { status: 200, data: { object: { sha: 'RESOLVED' } } } }),
    )
    const res = await seedFiles(api, REPO, files(2), identity)
    expect(res.sha).toBe('RESOLVED')
    // One initial getBranchHead (for baseSha) + one re-resolve after the 204.
    expect(calls.filter((c) => c.method === 'GET' && c.path.includes('/git/ref/heads/')).length).toBe(2)
  })

  it('409 conflict → ImportConflictError (no retry — a rare admin op, not the write path)', async () => {
    const { api } = fakeGh(router({ ...baseRoutes, 'POST /merges': { status: 409 } }))
    await expect(seedFiles(api, REPO, files(2), identity)).rejects.toBeInstanceOf(ImportConflictError)
  })

  it('binary content anywhere in the batch → ValidationError, zero GitHub calls', async () => {
    const { api, calls } = fakeGh(router(baseRoutes))
    const bad = [...files(2), { path: 'context/bad.md', content: 'a\u0000b' }]
    await expect(seedFiles(api, REPO, bad, identity)).rejects.toBeInstanceOf(ValidationError)
    expect(calls).toHaveLength(0)
  })

  it('oversize content → ValidationError, zero GitHub calls', async () => {
    const { api, calls } = fakeGh(router(baseRoutes))
    const bad = [{ path: 'context/big.md', content: 'x'.repeat(1024 * 1024 + 1) }]
    await expect(seedFiles(api, REPO, bad, identity)).rejects.toBeInstanceOf(ValidationError)
    expect(calls).toHaveLength(0)
  })
})
