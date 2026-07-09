import * as db from '@/db'
import type { AuthzDeps } from './auth/context'
import { GitContextService } from './context/service'
import type { ContextService, Principal } from './context/types'
import { NotFoundError } from './errors'
import { getEnv } from './env'
import { GitHubClient } from './github/client'
import type { GitHubApi } from './github/client'
import { getInstallationTokenProvider } from './github/singleton'
import type { RepoRef, WritePolicy } from './context/write-engine'

/** The GitHub App bot identity stamped as commit committer (author = the real actor). */
export function getBotCommitter() {
  const appId = getEnv().GITHUB_APP_ID
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
export const authzDeps: AuthzDeps = {
  findTokenByPrefix: db.findTokenByPrefix,
  getMemberRole: db.getMemberRole,
  touchTokenLastUsed: db.touchTokenLastUsed,
  auditDenied: (spaceId, principal) =>
    db.insertAudit({ spaceId, actorType: principal.type, actorId: principal.id, action: 'access_denied', outcome: 'denied' }),
}

/**
 * Effective write-back policy: a token's bound connector overrides the space
 * default. Resolved from the token's own stored connector_id — never from
 * anything the caller asserts — so an MCP-issued token can't claim to be the
 * trusted TEIO connector (ARCHITECTURE §3.1).
 */
async function resolveWritePolicy(spaceId: string, principal: Principal): Promise<WritePolicy> {
  const space = await db.getSpaceById(spaceId)
  if (!space) throw new NotFoundError(`space not found: ${spaceId}`)
  if (principal.type === 'token') {
    const connectorPolicy = await db.resolveConnectorPolicyForToken(principal.id, space.write_back_default)
    if (connectorPolicy) return connectorPolicy
  }
  return space.write_back_default
}

let _contextService: ContextService | null = null

/** The real ContextService: Neon for lookups + FTS, GitHub App for git ops. */
export function getContextService(): ContextService {
  if (!_contextService) {
    _contextService = new GitContextService({
      loadSpaceRepo: db.loadSpaceRepo,
      listSpacesForPrincipal: (principal) =>
        principal.type === 'user' ? db.listSpacesForUser(principal.id) : db.listSpacesForToken(principal.id),
      searchDocuments: db.searchDocuments,
      clientFor: clientForSpace,
      resolveWritePolicy,
      setCurrentSha: db.setCurrentSha,
      recordProposal: db.recordProposal,
      audit: db.insertAudit,
      botCommitter: getBotCommitter(),
    })
  }
  return _contextService
}
