import * as db from '@/db'
import type { AuthzDeps } from './auth/context'
import { GitContextService } from './context/service'
import type { ContextService } from './context/types'
import { NotFoundError } from './errors'
import { GitHubClient } from './github/client'
import { getInstallationTokenProvider } from './github/singleton'

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
    })
  }
  return _contextService
}
