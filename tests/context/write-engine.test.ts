import { describe, expect, it } from 'vitest'
import { GitHubError, NotFoundError, UnknownBaseError, ValidationError } from '@/lib/errors'
import type { GitHubApi } from '@/lib/github/client'
import { WriteEngine, type WriteOptions } from '@/lib/context/write-engine'

interface Stub {
  status: number
  data?: unknown
  message?: string
}
type Handler = (method: string, path: string, body?: unknown) => Stub
interface Call {
  method: string
  path: string
  body?: unknown
}

function router(routes: Record<string, Stub | Handler>): Handler {
  return (method, path, body) => {
    for (const key of Object.keys(routes)) {
      const idx = key.indexOf(' ')
      const m = key.slice(0, idx)
      const sub = key.slice(idx + 1)
      if (method === m && path.includes(sub)) {
        const v = routes[key]!
        return typeof v === 'function' ? v(method, path, body) : v
      }
    }
    throw new Error(`no route for ${method} ${path}`)
  }
}

function fakeGh(handler: Handler): { api: GitHubApi; calls: Call[] } {
  const calls: Call[] = []
  const api = {
    request: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body })
      const r = handler(method, path, body)
      if (r.status >= 400) throw new GitHubError(r.status, r.message ?? 'err', `${method} ${path}`)
      return { status: r.status, data: (r.data ?? null) as unknown }
    },
  } as unknown as GitHubApi
  return { api, calls }
}

// Successful stubs for the full 3-way sequence; spread + override per test.
const ok3way: Record<string, Stub> = {
  'GET /git/ref/heads/': { status: 200, data: { object: { sha: 'MAIN' } } },
  'GET /git/commits/': { status: 200, data: { tree: { sha: 'BASETREE' } } },
  'GET /contents/': { status: 200, data: { sha: 'FROMBLOB' } },
  'POST /git/blobs': { status: 201, data: { sha: 'NEWBLOB' } },
  'POST /git/trees': { status: 201, data: { sha: 'NEWTREE' } },
  'POST /git/commits': { status: 201, data: { sha: 'COMMIT' } },
  'POST /merges': { status: 201, data: { sha: 'MERGED' } },
  'POST /git/refs': { status: 201, data: {} },
  'POST /pulls': { status: 201, data: { number: 7, html_url: 'https://gh/pr/7' } },
  'PUT /contents/': { status: 200, data: { commit: { sha: 'CASCOMMIT' } } },
}

const REPO = { owner: 'teio', repo: 'teio-context-acme', branch: 'main' }
const engine = new WriteEngine({ committer: { name: 'bot', email: 'bot@x' }, newBranchName: () => 'proposal/fixed' })

function opts(overrides: Partial<WriteOptions> = {}): WriteOptions {
  return { policy: 'auto_merge_clean', author: { name: 'actor', email: 'a@x' }, ...overrides }
}

describe('WriteEngine — CAS fast path', () => {
  it('200 → merged via fast path, no 3-way calls', async () => {
    const { api, calls } = fakeGh(router({ 'PUT /contents/': { status: 200, data: { commit: { sha: 'CAS' } } } }))
    const res = await engine.write(api, REPO, { kind: 'upsert', path: 'context/a.md', content: 'hi' }, opts({ baseBlob: 'B0' }))
    expect(res).toEqual({ status: 'merged', version: 'CAS', viaFastPath: true })
    expect(calls.some((c) => c.path.includes('/merges'))).toBe(false)
    expect(calls.some((c) => c.path.includes('/git/blobs'))).toBe(false)
    expect((calls[0]!.body as { sha?: string }).sha).toBe('B0')
  })

  it('create (no baseBlob, file absent) → resolves 404 then PUT without sha → 201', async () => {
    const { api, calls } = fakeGh(
      router({ 'GET /contents/': { status: 404 }, 'PUT /contents/': { status: 201, data: { commit: { sha: 'NEW' } } } }),
    )
    const res = await engine.write(api, REPO, { kind: 'upsert', path: 'context/new.md', content: 'hi' }, opts())
    expect(res).toMatchObject({ status: 'merged', version: 'NEW', viaFastPath: true })
    const put = calls.find((c) => c.method === 'PUT')!
    expect('sha' in (put.body as object)).toBe(false)
  })

  it('409 → CAS miss → falls to 3-way path (merges called), viaFastPath false', async () => {
    const { api, calls } = fakeGh(router({ ...ok3way, 'PUT /contents/': { status: 409 } }))
    const res = await engine.write(api, REPO, { kind: 'upsert', path: 'context/a.md', content: 'hi' }, opts({ baseBlob: 'B0' }))
    expect(res).toEqual({ status: 'merged', version: 'MERGED', viaFastPath: false })
    expect(calls.some((c) => c.path.includes('/merges'))).toBe(true)
  })

  it('404 → unknown_base', async () => {
    const { api } = fakeGh(router({ 'PUT /contents/': { status: 404 } }))
    await expect(
      engine.write(api, REPO, { kind: 'upsert', path: 'context/a.md', content: 'hi' }, opts({ baseBlob: 'B0' })),
    ).rejects.toBeInstanceOf(UnknownBaseError)
  })

  it('422 → unknown_base', async () => {
    const { api } = fakeGh(router({ 'PUT /contents/': { status: 422 } }))
    await expect(
      engine.write(api, REPO, { kind: 'upsert', path: 'context/a.md', content: 'hi' }, opts({ baseBlob: 'B0' })),
    ).rejects.toBeInstanceOf(UnknownBaseError)
  })
})

describe('WriteEngine — 3-way path', () => {
  it('delete → clean merge (tree entry sha=null, no blob created)', async () => {
    const { api, calls } = fakeGh(router(ok3way))
    const res = await engine.write(api, REPO, { kind: 'delete', path: 'context/a.md' }, opts({ baseVersion: 'BASE' }))
    expect(res).toEqual({ status: 'merged', version: 'MERGED', viaFastPath: false })
    const tree = calls.find((c) => c.path.includes('/git/trees'))!.body as { tree: { path: string; sha: string | null }[] }
    expect(tree.tree).toEqual([{ path: 'context/a.md', mode: '100644', type: 'blob', sha: null }])
    expect(calls.some((c) => c.path.includes('/git/blobs'))).toBe(false)
  })

  it('204 already-merged → re-resolves HEAD, version is NOT the empty body', async () => {
    const { api, calls } = fakeGh(
      router({ ...ok3way, 'POST /merges': { status: 204 }, 'GET /git/ref/heads/': { status: 200, data: { object: { sha: 'RERESOLVED' } } } }),
    )
    const res = await engine.write(api, REPO, { kind: 'delete', path: 'context/a.md' }, opts({ baseVersion: 'BASE' }))
    expect(res).toEqual({ status: 'merged', version: 'RERESOLVED', viaFastPath: false })
    // getBranchHead ran AFTER the 204 to recover the real sha
    expect(calls.filter((c) => c.method === 'GET' && c.path.includes('/git/ref/heads/')).length).toBe(1)
  })

  it('409 → conflict → PR opened', async () => {
    const { api, calls } = fakeGh(router({ ...ok3way, 'POST /merges': { status: 409 } }))
    const res = await engine.write(api, REPO, { kind: 'delete', path: 'context/a.md' }, opts({ baseVersion: 'BASE' }))
    expect(res).toMatchObject({ status: 'conflict', prNumber: 7, prUrl: 'https://gh/pr/7', branchRef: 'refs/heads/proposal/fixed' })
    const pr = calls.find((c) => c.path.includes('/pulls'))!.body as { head: string; base: string }
    expect(pr).toMatchObject({ head: 'proposal/fixed', base: 'main' })
  })

  it('proposal_only → opens a PR even when it would merge clean (merges never called)', async () => {
    const { api, calls } = fakeGh(router(ok3way))
    const res = await engine.write(
      api,
      REPO,
      { kind: 'upsert', path: 'context/a.md', content: 'hi' },
      opts({ policy: 'proposal_only', baseVersion: 'BASE' }),
    )
    expect(res).toMatchObject({ status: 'proposal', prNumber: 7 })
    expect(calls.some((c) => c.path.includes('/merges'))).toBe(false)
    expect(calls.some((c) => c.path.includes('/contents/'))).toBe(false) // no CAS fast path
  })

  it('base commit unreachable (getCommitTree 404) → unknown_base', async () => {
    const { api } = fakeGh(router({ ...ok3way, 'GET /git/commits/': { status: 404 } }))
    await expect(
      engine.write(api, REPO, { kind: 'delete', path: 'context/a.md' }, opts({ baseVersion: 'GONE' })),
    ).rejects.toBeInstanceOf(UnknownBaseError)
  })

  it('baseVersion omitted → resolves base from branch HEAD', async () => {
    const { api, calls } = fakeGh(router(ok3way))
    await engine.write(api, REPO, { kind: 'delete', path: 'context/a.md' }, opts())
    expect(calls[0]).toMatchObject({ method: 'GET', path: expect.stringContaining('/git/ref/heads/main') })
  })
})

describe('WriteEngine — ref-race retry', () => {
  it('merges 404 x3 → unknown_base (retry cap)', async () => {
    const { api, calls } = fakeGh(router({ ...ok3way, 'POST /merges': { status: 404 } }))
    await expect(
      engine.write(api, REPO, { kind: 'delete', path: 'context/a.md' }, opts({ baseVersion: 'BASE' })),
    ).rejects.toBeInstanceOf(UnknownBaseError)
    expect(calls.filter((c) => c.path.includes('/merges')).length).toBe(3)
  })

  it('merges 404 then 201 → merged (retry recovers)', async () => {
    let n = 0
    const { api } = fakeGh(
      router({ ...ok3way, 'POST /merges': () => (n++ === 0 ? { status: 404 } : { status: 201, data: { sha: 'MERGED2' } }) }),
    )
    const res = await engine.write(api, REPO, { kind: 'delete', path: 'context/a.md' }, opts({ baseVersion: 'BASE' }))
    expect(res).toMatchObject({ status: 'merged', version: 'MERGED2' })
  })
})

describe('WriteEngine — validation guards (no GitHub calls)', () => {
  it('binary content (NUL byte) → ValidationError', async () => {
    const { api, calls } = fakeGh(router(ok3way))
    await expect(
      engine.write(api, REPO, { kind: 'upsert', path: 'context/a.md', content: 'a\u0000b' }, opts()),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(calls).toHaveLength(0)
  })

  it('content over 1 MiB → ValidationError', async () => {
    const { api, calls } = fakeGh(router(ok3way))
    const big = 'x'.repeat(1024 * 1024 + 1)
    await expect(engine.write(api, REPO, { kind: 'upsert', path: 'context/a.md', content: big }, opts())).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(calls).toHaveLength(0)
  })
})

describe('WriteEngine — move (true git rename)', () => {
  it('reuses the source blob (from→null, to→source sha) and creates no new blob', async () => {
    const { api, calls } = fakeGh(router(ok3way))
    const res = await engine.write(api, REPO, { kind: 'move', from: 'context/a.md', to: 'context/b.md' }, opts({ baseVersion: 'BASE' }))
    expect(res).toMatchObject({ status: 'merged', version: 'MERGED' })
    const tree = calls.find((c) => c.path.includes('/git/trees'))!.body as { tree: { path: string; sha: string | null }[] }
    expect(tree.tree).toEqual([
      { path: 'context/a.md', mode: '100644', type: 'blob', sha: null },
      { path: 'context/b.md', mode: '100644', type: 'blob', sha: 'FROMBLOB' },
    ])
    expect(calls.some((c) => c.path.includes('/git/blobs'))).toBe(false)
  })

  it('source path missing → NotFoundError', async () => {
    const { api } = fakeGh(router({ ...ok3way, 'GET /contents/': { status: 404 } }))
    await expect(
      engine.write(api, REPO, { kind: 'move', from: 'context/gone.md', to: 'context/b.md' }, opts({ baseVersion: 'BASE' })),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
