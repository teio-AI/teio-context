import { describe, expect, it, vi } from 'vitest'
import type { ContextServiceDeps } from '@/lib/context/service'
import { GitContextService } from '@/lib/context/service'
import { GitHubError, NotFoundError } from '@/lib/errors'
import type { GitHubApi } from '@/lib/github/client'

function ghReturning(map: Record<string, unknown | (() => unknown)>): GitHubApi {
  return {
    request: async (_m: string, path: string) => {
      for (const key of Object.keys(map)) {
        if (path.includes(key)) {
          const entry = map[key]
          const value = typeof entry === 'function' ? (entry as () => unknown)() : entry
          if (value instanceof GitHubError) throw value
          return { status: 200, data: value }
        }
      }
      throw new Error(`no stub for ${path}`)
    },
  } as unknown as GitHubApi
}

function makeDeps(overrides: Partial<ContextServiceDeps> = {}): ContextServiceDeps {
  return {
    loadSpaceRepo: vi.fn(async () => ({ owner: 'teio', repo: 'teio-context-acme', defaultBranch: 'main' })),
    clientFor: vi.fn(async () =>
      ghReturning({
        '/git/ref/heads/main': { object: { sha: 'commitsha' } },
        '/contents/': { content: Buffer.from('hello world', 'utf8').toString('base64'), encoding: 'base64', sha: 'blobsha' },
      }),
    ),
    listSpacesForPrincipal: vi.fn(async () => []),
    searchDocuments: vi.fn(async () => []),
    listOpenProposals: vi.fn(async () => []),
    // Write deps (unused by the read-path tests below; see service-write.test.ts).
    resolveWritePolicy: vi.fn(async () => 'auto_merge_clean' as const),
    setCurrentSha: vi.fn(async () => {}),
    reindexChanged: vi.fn(async () => ({ indexed: 0, removed: 0 })),
    recordProposal: vi.fn(async () => 'prop-x'),
    audit: vi.fn(async () => {}),
    botCommitter: () => ({ name: 'bot', email: 'bot@x' }),
    ...overrides,
  }
}

const principal = { type: 'user', id: 'u' } as const

describe('GitContextService', () => {
  it('getVersion returns the branch head sha', async () => {
    const svc = new GitContextService(makeDeps())
    const v = await svc.getVersion(principal, 's1')
    expect(v.sha).toBe('commitsha')
  })

  it('getVersion translates a GitHub 404 into NotFoundError', async () => {
    const deps = makeDeps({
      clientFor: async () => ghReturning({ '/git/ref/heads/main': () => new GitHubError(404, 'Not Found', 'GET /ref') }),
    })
    await expect(new GitContextService(deps).getVersion(principal, 's1')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('getDocument decodes content, returns blob + version, and hits loadSpaceRepo/clientFor exactly once each', async () => {
    const deps = makeDeps()
    const d = await new GitContextService(deps).getDocument(principal, 's1', 'context/overview.md')

    expect(d.content).toBe('hello world')
    expect(d.blob).toBe('blobsha')
    expect(d.version).toBe('commitsha')
    // Regression guard: Phase 1's getDocument called getVersion() internally,
    // doubling loadSpaceRepo + clientFor for a single document read.
    expect(deps.loadSpaceRepo).toHaveBeenCalledTimes(1)
    expect(deps.clientFor).toHaveBeenCalledTimes(1)
  })

  it('getDocument translates a GitHub 404 on the content call into NotFoundError', async () => {
    const deps = makeDeps({
      clientFor: async () =>
        ghReturning({
          '/git/ref/heads/main': { object: { sha: 'commitsha' } },
          '/contents/': () => new GitHubError(404, 'Not Found', 'GET /contents'),
        }),
    })
    await expect(new GitContextService(deps).getDocument(principal, 's1', 'context/missing.md')).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('listSpaces delegates to listSpacesForPrincipal with the principal', async () => {
    const listSpacesForPrincipal = vi.fn(async () => [{ id: 's1', slug: 'acme', name: 'Acme', role: 'admin' as const }])
    const spaces = await new GitContextService(makeDeps({ listSpacesForPrincipal })).listSpaces(principal)
    expect(spaces).toHaveLength(1)
    expect(listSpacesForPrincipal).toHaveBeenCalledWith(principal)
  })

  it('search delegates to searchDocuments with spaceId + query', async () => {
    const searchDocuments = vi.fn(async () => [{ path: 'context/x.md', snippet: 'hit' }])
    const results = await new GitContextService(makeDeps({ searchDocuments })).search(principal, 's1', 'billing')
    expect(results).toEqual([{ path: 'context/x.md', snippet: 'hit' }])
    expect(searchDocuments).toHaveBeenCalledWith('s1', 'billing')
  })

  it('listProposals delegates to listOpenProposals for the space', async () => {
    const listOpenProposals = vi.fn(async () => [{ id: 'p1', status: 'open' }])
    const proposals = await new GitContextService(makeDeps({ listOpenProposals })).listProposals(principal, 's1')
    expect(proposals).toEqual([{ id: 'p1', status: 'open' }])
    expect(listOpenProposals).toHaveBeenCalledWith('s1')
  })
})
