import { describe, expect, it } from 'vitest'
import { FreeTierProtectionError, GitHubError } from '@/lib/errors'
import type { GitHubApi } from '@/lib/github/client'
import { provisionSpaceRepo } from '@/lib/github/provision'

interface Call {
  method: string
  path: string
  body?: unknown
}

function fakeGh(handler: (method: string, path: string, body?: unknown) => { status: number; data: unknown }): {
  api: GitHubApi
  calls: Call[]
} {
  const calls: Call[] = []
  const api = {
    request: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body })
      const r = handler(method, path, body)
      return { status: r.status, data: r.data }
    },
  } as unknown as GitHubApi
  return { api, calls }
}

describe('provisionSpaceRepo', () => {
  it('creates repo, seeds space.yaml, then a PR-required ruleset with the App as bypass actor', async () => {
    const { api, calls } = fakeGh((m, p) => {
      if (m === 'POST' && p.endsWith('/repos')) return { status: 201, data: {} }
      if (m === 'PUT' && p.includes('/contents/space.yaml')) return { status: 201, data: {} }
      if (m === 'POST' && p.endsWith('/rulesets')) return { status: 201, data: { id: 99 } }
      if (m === 'GET' && p.includes('/git/ref/heads/main')) return { status: 200, data: { object: { sha: 'abc123' } } }
      throw new Error(`unexpected ${m} ${p}`)
    })

    const res = await provisionSpaceRepo(api, {
      owner: 'teio',
      repo: 'teio-context-acme',
      appId: 4256555,
      spaceYaml: 'name: Acme\n',
    })

    expect(res).toMatchObject({
      owner: 'teio',
      repo: 'teio-context-acme',
      defaultBranch: 'main',
      mainSha: 'abc123',
      rulesetId: 99,
    })

    const ruleset = calls.find((c) => c.path.endsWith('/rulesets'))!.body as {
      bypass_actors: unknown[]
      rules: { type: string }[]
    }
    expect(ruleset.bypass_actors).toEqual([{ actor_id: 4256555, actor_type: 'Integration', bypass_mode: 'always' }])
    expect(ruleset.rules.map((r) => r.type)).toEqual(expect.arrayContaining(['pull_request', 'non_fast_forward', 'deletion']))

    // seed BEFORE protection (finding #3)
    const seedIdx = calls.findIndex((c) => c.path.includes('space.yaml'))
    const rulesetIdx = calls.findIndex((c) => c.path.endsWith('/rulesets'))
    expect(seedIdx).toBeGreaterThanOrEqual(0)
    expect(seedIdx).toBeLessThan(rulesetIdx)
  })

  it('fails loud with FreeTierProtectionError when rulesets are unavailable (free-tier 403)', async () => {
    const { api } = fakeGh((m, p) => {
      if (m === 'POST' && p.endsWith('/repos')) return { status: 201, data: {} }
      if (m === 'PUT' && p.includes('/contents/space.yaml')) return { status: 201, data: {} }
      if (m === 'POST' && p.endsWith('/rulesets')) {
        throw new GitHubError(403, 'Upgrade to GitHub Pro or make this repository public to enable this feature.', 'POST /rulesets')
      }
      return { status: 200, data: {} }
    })

    await expect(
      provisionSpaceRepo(api, { owner: 'ravi', repo: 'x', appId: 1, spaceYaml: '' }),
    ).rejects.toBeInstanceOf(FreeTierProtectionError)
  })

  it('opt-in: allowUnprotected creates the space WITHOUT protection when rulesets 403', async () => {
    const { api, calls } = fakeGh((m, p) => {
      if (m === 'POST' && p.endsWith('/repos')) return { status: 201, data: {} }
      if (m === 'PUT' && p.includes('/contents/space.yaml')) return { status: 201, data: {} }
      if (m === 'POST' && p.endsWith('/rulesets')) {
        throw new GitHubError(403, 'Upgrade to GitHub Pro or make this repository public to enable this feature.', 'POST /rulesets')
      }
      if (m === 'GET' && p.includes('/git/ref/heads/main')) return { status: 200, data: { object: { sha: 'z9' } } }
      throw new Error(`unexpected ${m} ${p}`)
    })

    const res = await provisionSpaceRepo(api, { owner: 'ravi', repo: 'x', appId: 1, spaceYaml: '', private: true, allowUnprotected: true })

    // Space is still created (main SHA resolved), just unprotected.
    expect(res).toMatchObject({ mainSha: 'z9', rulesetId: null, protected: false })
    // The private repo was still created.
    expect((calls.find((c) => c.path.endsWith('/repos'))!.body as { private: boolean }).private).toBe(true)
  })

  it('dev mode: creates a PUBLIC repo under a USER account (/user/repos, private:false)', async () => {
    const { api, calls } = fakeGh((m, p) => {
      if (m === 'POST' && p.endsWith('/repos')) return { status: 201, data: {} }
      if (m === 'PUT' && p.includes('/contents/space.yaml')) return { status: 201, data: {} }
      if (m === 'POST' && p.endsWith('/rulesets')) return { status: 201, data: { id: 1 } }
      if (m === 'GET' && p.includes('/git/ref/heads/main')) return { status: 200, data: { object: { sha: 's' } } }
      throw new Error(`unexpected ${m} ${p}`)
    })

    await provisionSpaceRepo(api, { owner: 'ravi-teio', ownerType: 'user', repo: 'r', appId: 1, spaceYaml: '', private: false })

    const create = calls.find((c) => c.path.endsWith('/repos'))!
    expect(create.path).toBe('/user/repos') // user account, not /orgs/...
    expect((create.body as { private: boolean }).private).toBe(false) // public → rulesets free
  })
})
