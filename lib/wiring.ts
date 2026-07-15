import * as db from '@/db'
import type { AuthzDeps } from './auth/context'
import { GitContextService } from './context/service'
import { reindexChangedPaths } from './context/reindex'
import type { ContextService, Principal } from './context/types'
import { NotFoundError } from './errors'
import { getEnv, getGitHubConfig } from './env'
import { isStaff, parseStaffIds } from './auth/staff'
import { GitHubClient } from './github/client'
import type { GitHubApi } from './github/client'
import { getInstallationTokenProvider } from './github/singleton'
import type { RepoRef, WritePolicy } from './context/write-engine'

/**
 * The GitHub App bot identity stamped as commit committer (author = the real
 * actor). Lazy: only invoked on a write, so DB-only reads never require the
 * GitHub App to be configured (throws `github_unconfigured` if it isn't).
 */
export function getBotCommitter() {
  const { appId } = getGitHubConfig()
  return { name: 'teio-context[bot]', email: `${appId}+teio-context[bot]@users.noreply.github.com` }
}

/**
 * A GitHub client bound to a space's installation token. Standalone (not a
 * closure inside getContextService) so the import route can reuse it without
 * going through ContextService's write-engine machinery.
 */
export async function clientForSpace(spaceId: string): Promise<GitHubApi> {
  const space = await db.getSpaceById(spaceId)
  if (!space) throw new NotFoundError(`space not found: ${spaceId}`)
  const token = await getInstallationTokenProvider().getToken(Number(space.github_installation_id))
  return new GitHubClient(token)
}

export async function repoRefForSpace(spaceId: string): Promise<RepoRef> {
  const { owner, repo, defaultBranch } = await db.loadSpaceRepo(spaceId)
  return { owner, repo, branch: defaultBranch }
}

/** Concrete auth dependencies, shared by every space-scoped route. */
/** True when the Clerk user is a global Owner (space creator / admin-anywhere). */
export function isGlobalOwner(userId: string): boolean {
  return isStaff(userId, parseStaffIds(getEnv().STAFF_USER_IDS))
}

export const authzDeps: AuthzDeps = {
  findTokenByPrefix: db.findTokenByPrefix,
  getMemberRole: db.getMemberRole,
  isGlobalOwner,
  touchTokenLastUsed: db.touchTokenLastUsed,
  auditDenied: (spaceId, principal, requestId) =>
    db.insertAudit({ spaceId, actorType: principal.type, actorId: principal.id, action: 'access_denied', outcome: 'denied', requestId }),
}

/**
 * Effective write-back policy. Default is auto-merge; a token opts into review
 * (proposal_only) via its own `proposal_only` flag — never anything the caller
 * asserts. Humans (Clerk members) always auto-merge.
 */
async function resolveWritePolicy(_spaceId: string, principal: Principal): Promise<WritePolicy> {
  if (principal.type === 'token' && (await db.getTokenProposalOnly(principal.id))) {
    return 'proposal_only'
  }
  return 'auto_merge_clean'
}

let _contextService: ContextService | null = null

/** The real ContextService: Neon for lookups + FTS, GitHub App for git ops. */
export function getContextService(): ContextService {
  if (!_contextService) {
    _contextService = new GitContextService({
      loadSpaceRepo: db.loadSpaceRepo,
      listSpacesForPrincipal: async (principal) => {
        if (principal.type === 'token') return db.listSpacesForToken(principal.id)
        // A global Owner sees every project (they administer all of them).
        if (isGlobalOwner(principal.id)) {
          return (await db.listActiveSpaces()).map((s) => ({ id: s.id, slug: s.slug, name: s.name, role: 'admin' as const }))
        }
        return db.listSpacesForUser(principal.id)
      },
      searchDocuments: db.searchDocuments,
      listOpenProposals: db.listOpenProposals,
      clientFor: clientForSpace,
      resolveWritePolicy,
      setCurrentSha: db.setCurrentSha,
      reindexChanged: (gh, repo, spaceId, changed, commitSha) =>
        reindexChangedPaths(gh, repo, spaceId, changed, commitSha),
      recordProposal: db.recordProposal,
      audit: db.insertAudit,
      // Passed as a thunk (not called here) so constructing the service for a
      // DB-only read never forces GitHub config to exist.
      botCommitter: getBotCommitter,
    })
  }
  return _contextService
}
