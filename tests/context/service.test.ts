import { describe, expect, it } from 'vitest'
import { GitContextService } from '@/lib/context/service'
import { NotImplementedError } from '@/lib/errors'
import type { GitHubApi } from '@/lib/github/client'

function ghReturning(map: Record<string, unknown>): GitHubApi {
  return {
    request: async (_m: string, path: string) => {
      for (const key of Object.keys(map)) {
        if (path.includes(key)) return { status: 200, data: map[key] }
      }
      throw new Error(`no stub for ${path}`)
    },
  } as unknown as GitHubApi
}

const deps = {
  loadSpaceRepo: async () => ({ owner: 'teio', repo: 'teio-context-acme', defaultBranch: 'main' }),
  clientFor: async () =>
    ghReturning({
      '/git/ref/heads/main': { object: { sha: 'commitsha' } },
      '/contents/': { content: Buffer.from('hello world', 'utf8').toString('base64'), encoding: 'base64', sha: 'blobsha' },
    }),
}

describe('GitContextService (Phase 1 read path)', () => {
  const svc = new GitContextService(deps)
  const principal = { type: 'user', id: 'u' } as const

  it('getVersion returns the branch head sha', async () => {
    const v = await svc.getVersion(principal, 's1')
    expect(v.sha).toBe('commitsha')
  })

  it('getDocument decodes content and returns blob + version', async () => {
    const d = await svc.getDocument(principal, 's1', 'context/overview.md')
    expect(d.content).toBe('hello world')
    expect(d.blob).toBe('blobsha')
    expect(d.version).toBe('commitsha')
  })

  it('proposeUpdate is not implemented in Phase 1', async () => {
    await expect(
      svc.proposeUpdate(principal, 's1', { path: 'context/x.md', content: 'y' }),
    ).rejects.toBeInstanceOf(NotImplementedError)
  })
})
