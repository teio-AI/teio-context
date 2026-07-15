import { describe, expect, it, vi } from 'vitest'
import { GitHubError } from '@/lib/errors'
import type { GitHubApi } from '@/lib/github/client'
import { GitContextService, type ContextServiceDeps } from '@/lib/context/service'
import type { WritePolicy } from '@/lib/context/write-engine'

interface Stub {
  status: number
  data?: unknown
}
type Handler = (m: string, p: string, b?: unknown) => Stub

function gh(routes: Record<string, Stub>): GitHubApi {
  return {
    request: async (method: string, path: string) => {
      for (const key of Object.keys(routes)) {
        const idx = key.indexOf(' ')
        if (method === key.slice(0, idx) && path.includes(key.slice(idx + 1))) {
          const r = routes[key]!
          if (r.status >= 400) throw new GitHubError(r.status, 'err', `${method} ${path}`)
          return { status: r.status, data: (r.data ?? null) as unknown }
        }
      }
      throw new Error(`no route for ${method} ${path}`)
    },
  } as unknown as GitHubApi
}

const ok3way: Record<string, Stub> = {
  'GET /git/ref/heads/': { status: 200, data: { object: { sha: 'MAIN' } } },
  'GET /git/commits/': { status: 200, data: { tree: { sha: 'BASETREE' } } },
  'POST /git/blobs': { status: 201, data: { sha: 'BLOB' } },
  'POST /git/trees': { status: 201, data: { sha: 'TREE' } },
  'POST /git/commits': { status: 201, data: { sha: 'COMMIT' } },
  'POST /merges': { status: 201, data: { sha: 'MERGED' } },
  'POST /git/refs': { status: 201, data: {} },
  'POST /pulls': { status: 201, data: { number: 9, html_url: 'https://gh/pr/9' } },
}

function makeService(policy: WritePolicy, routes: Record<string, Stub>) {
  const setCurrentSha = vi.fn(async () => {})
  const recordProposal = vi.fn(async () => 'prop-1')
  const audit = vi.fn(async () => {})
  const reindexChanged = vi.fn(async () => ({ indexed: 1, removed: 0 }))
  const deps: ContextServiceDeps = {
    loadSpaceRepo: async () => ({ owner: 'teio', repo: 'teio-context-acme', defaultBranch: 'main' }),
    clientFor: async () => gh(routes),
    listSpacesForPrincipal: async () => [],
    searchDocuments: async () => [],
    listOpenProposals: async () => [],
    resolveWritePolicy: async () => policy,
    setCurrentSha,
    reindexChanged,
    recordProposal,
    audit,
    botCommitter: () => ({ name: 'bot', email: 'bot@x' }),
    newBranchName: () => 'proposal/fixed',
  }
  return { svc: new GitContextService(deps), setCurrentSha, recordProposal, audit, reindexChanged }
}

const principal = { type: 'user', id: 'user_1' } as const

describe('GitContextService write persistence', () => {
  it('upsert fast-path merged → reindex + setCurrentSha + audit(cas_write)', async () => {
    const { svc, setCurrentSha, recordProposal, audit, reindexChanged } = makeService('auto_merge_clean', {
      'PUT /contents/': { status: 200, data: { commit: { sha: 'CAS' } } },
    })
    const res = await svc.proposeUpdate(principal, 's1', { path: 'context/a.md', content: 'hi', baseBlob: 'B0' })

    expect(res).toEqual({ status: 'merged', version: 'CAS' })
    // Regression: a merged API write MUST update the derived FTS index itself —
    // it advances current_sha, which dedups the push webhook out, so if it
    // didn't reindex here the write would never reach search.
    expect(reindexChanged).toHaveBeenCalledWith(
      expect.anything(),
      { owner: 'teio', repo: 'teio-context-acme', branch: 'main' },
      's1',
      { upserted: ['context/a.md'], removed: [] },
      'CAS',
    )
    expect(setCurrentSha).toHaveBeenCalledWith('s1', 'CAS')
    expect(recordProposal).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cas_write', path: 'context/a.md', resultSha: 'CAS', outcome: 'ok' }),
    )
  })

  it('proposal_only → no derived-state update; recordProposal + audit(propose) + proposalId', async () => {
    const { svc, setCurrentSha, recordProposal, audit, reindexChanged } = makeService('proposal_only', ok3way)
    const res = await svc.proposeUpdate(principal, 's1', { path: 'context/a.md', content: 'hi', baseVersion: 'BASE' })

    expect(res).toEqual({ status: 'proposal', prUrl: 'https://gh/pr/9', proposalId: 'prop-1' })
    // A proposal doesn't touch main, so nothing is reindexed/advanced.
    expect(reindexChanged).not.toHaveBeenCalled()
    expect(setCurrentSha).not.toHaveBeenCalled()
    expect(recordProposal).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'proposal', branchRef: 'refs/heads/proposal/fixed', prNumber: 9 }),
    )
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'propose', outcome: 'ok' }))
  })

  it('delete merged → reindex removes the path; audit action is "delete"', async () => {
    const { svc, setCurrentSha, audit, reindexChanged } = makeService('auto_merge_clean', ok3way)
    const res = await svc.deletePath(principal, 's1', { path: 'context/a.md', baseVersion: 'BASE' })

    expect(res).toEqual({ status: 'merged', version: 'MERGED' })
    expect(reindexChanged).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      's1',
      { upserted: [], removed: ['context/a.md'] },
      'MERGED',
    )
    expect(setCurrentSha).toHaveBeenCalledWith('s1', 'MERGED')
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', resultSha: 'MERGED' }))
  })

  it('merged write survives a reindex failure (durable git write, current_sha left for cron)', async () => {
    const { svc, setCurrentSha, audit, reindexChanged } = makeService('auto_merge_clean', {
      'PUT /contents/': { status: 200, data: { commit: { sha: 'CAS' } } },
    })
    reindexChanged.mockRejectedValueOnce(new Error('neon blip'))
    const res = await svc.proposeUpdate(principal, 's1', { path: 'context/a.md', content: 'hi', baseBlob: 'B0' })

    // The commit landed, so the write still succeeds; current_sha is NOT advanced
    // (stays behind so the backfill cron reconciles the index).
    expect(res).toEqual({ status: 'merged', version: 'CAS' })
    expect(setCurrentSha).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'cas_write', outcome: 'ok' }))
  })

  it('conflict → recordProposal(conflict) + audit(conflict_pr, outcome conflict)', async () => {
    // CAS miss (PUT 409) → 3-way → real conflict (merges 409) → PR.
    const { svc, recordProposal, audit } = makeService('auto_merge_clean', {
      ...ok3way,
      'PUT /contents/': { status: 409 },
      'POST /merges': { status: 409 },
    })
    const res = await svc.proposeUpdate(principal, 's1', { path: 'context/a.md', content: 'hi', baseVersion: 'BASE', baseBlob: 'B0' })

    expect(res).toMatchObject({ status: 'conflict', proposalId: 'prop-1' })
    expect(recordProposal).toHaveBeenCalledWith(expect.objectContaining({ status: 'conflict' }))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'conflict_pr', outcome: 'conflict' }))
  })

  it('move merged → audit action is "move" and no blob is created', async () => {
    const calls: string[] = []
    const routes = { ...ok3way, 'GET /contents/': { status: 200, data: { sha: 'FROMBLOB' } } }
    const { svc, audit } = makeService('auto_merge_clean', routes)
    const res = await svc.movePath(principal, 's1', { from: 'context/a.md', to: 'context/b.md', baseVersion: 'BASE' })
    void calls
    expect(res).toEqual({ status: 'merged', version: 'MERGED' })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'move', path: 'context/a.md → context/b.md' }))
  })
})
