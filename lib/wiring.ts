import * as db from '@/db'
import type { AuthzDeps } from './auth/context'
import { GitContextService } from './context/service'
import type { ContextService } from './context/types'
import { NotFoundError } from './errors'
import { getEnv } from './env'
import { GitHubClient } from './github/client'
import { getInstallationTokenProvider } from './github/singleton'
import type { WritePolicy } from './context/write-engine'

/** The GitHub App bot identity stamped as commit committer (author = the real actor). */
function botCommitter() {
  const appId = getEnv().GITHUB_APP_ID
  return { name: 'teio-context[bot]', email: `${appId}+teio-context[bot]@users.noreply.github.com` }
}

/** Concrete auth dependencies, shared by every space-scoped route. */
export const authzDeps: AuthzDeps = {
  findTokenByPrefix: db.findTokenByPrefix,
  getMemberRole: db.getMemberRole,
  touchTokenLastUsed: db.touchTokenLastUsed,
  auditDenied: (spaceId, principal) =>
    db.insertAudit({ spaceId, actorType: principal.type, actorId: principal.id, action: 'access_denied', outcome: 'denied' }),
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
      clientFor: async (spaceId) => {
        const space = await db.getSpaceById(spaceId)
        if (!space) throw new NotFoundError(`space not found: ${spaceId}`)
        const token = await getInstallationTokenProvider().getToken(Number(space.github_installation_id))
        return new GitHubClient(token)
      },
      resolveWritePolicy: async (spaceId): Promise<WritePolicy> => {
        const space = await db.getSpaceById(spaceId)
        if (!space) throw new NotFoundError(`space not found: ${spaceId}`)
        // Connector-level override lands in Phase 4; v1 uses the space default.
        return space.write_back_default
      },
      setCurrentSha: db.setCurrentSha,
      recordProposal: db.recordProposal,
      audit: db.insertAudit,
      botCommitter: botCommitter(),
    })
  }
  return _contextService
}
