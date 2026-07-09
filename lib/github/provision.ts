import { FreeTierProtectionError, GitHubError } from '../errors'
import type { GitHubApi } from './client'

export interface ProvisionParams {
  /** Org (or user) login that will own the repo. Must be a paid org for private rulesets. */
  owner: string
  ownerType?: 'org' | 'user'
  repo: string
  /** The GitHub App id, added as the ruleset bypass actor. */
  appId: number
  /** Initial space.yaml contents to seed. */
  spaceYaml: string
}

export interface ProvisionResult {
  owner: string
  repo: string
  defaultBranch: string
  mainSha: string
  rulesetId: number
}

/**
 * Provision a space repo, in the order the review + spike fixed (ARCHITECTURE §6):
 *   1. create the private repo WITH an initial commit (auto_init) so `main` exists
 *   2. seed space.yaml on main
 *   3. create a PR-required ruleset with the App as a bypass actor + force-push/deletion off
 *
 * Fails LOUD with FreeTierProtectionError if step 3 hits the free-tier 403 —
 * we never create an unprotected space (base_version integrity, §7.1).
 */
export async function provisionSpaceRepo(gh: GitHubApi, p: ProvisionParams): Promise<ProvisionResult> {
  const createPath = p.ownerType === 'user' ? '/user/repos' : `/orgs/${p.owner}/repos`
  await gh.request('POST', createPath, {
    name: p.repo,
    private: true,
    auto_init: true, // seeds README + creates `main` (finding #3: main must exist before protection)
    description: 'teio-context space',
  })

  await gh.request('PUT', `/repos/${p.owner}/${p.repo}/contents/space.yaml`, {
    message: 'seed space.yaml',
    content: Buffer.from(p.spaceYaml, 'utf8').toString('base64'),
    branch: 'main',
  })

  let rulesetId: number
  try {
    const rs = await gh.request<{ id: number }>('POST', `/repos/${p.owner}/${p.repo}/rulesets`, rulesetBody(p.appId))
    rulesetId = rs.data.id
  } catch (err) {
    if (err instanceof GitHubError && err.status === 403 && /upgrade|make this repository public|pro\b/i.test(err.message)) {
      throw new FreeTierProtectionError(p.owner, p.repo)
    }
    throw err
  }

  const ref = await gh.request<{ object: { sha: string } }>('GET', `/repos/${p.owner}/${p.repo}/git/ref/heads/main`)
  return { owner: p.owner, repo: p.repo, defaultBranch: 'main', mainSha: ref.data.object.sha, rulesetId }
}

/**
 * PR-required ruleset with the App as bypass actor. Verified in the Phase 0 spike:
 * without the bypass actor, the App's writes are blocked 409; with it, 201.
 */
export function rulesetBody(appId: number) {
  return {
    name: 'teio-context-protection',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      { type: 'non_fast_forward' }, // blocks force-push (base_version integrity, §7.1)
      { type: 'deletion' }, // blocks branch deletion
    ],
    bypass_actors: [{ actor_id: appId, actor_type: 'Integration', bypass_mode: 'always' }],
  }
}
