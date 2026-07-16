import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import * as db from '@/db'
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '@/lib/errors'
import { getEnv, getGitHubConfig } from '@/lib/env'
import { isStaff, parseStaffIds } from '@/lib/auth/staff'
import { getInstallationId } from '@/lib/github/app-auth'
import { GitHubClient } from '@/lib/github/client'
import { getInstallationTokenProvider } from '@/lib/github/singleton'
import { provisionSpaceRepo } from '@/lib/github/provision'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { renderSpaceYaml } from '@/lib/space-yaml'
import { authzDeps, getContextService } from '@/lib/wiring'
import { resolvePrincipal } from '@/lib/auth/context'

export const runtime = 'nodejs'

const Body = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/, 'slug must be lowercase alphanumeric with dashes'),
  name: z.string().min(1).max(200),
})

/** List spaces the caller (Clerk user or machine token) is a member of. */
export async function GET(req: Request): Promise<Response> {
  try {
    const { principal } = await resolvePrincipal(req, authzDeps)
    const spaces = await getContextService().listSpaces(principal)
    return Response.json({ spaces })
  } catch (err) {
    return toResponse(err)
  }
}

/**
 * Create a space: provision the git repo (seed commit → PR-required ruleset with
 * App bypass) then register it in Neon and make the creator an owner.
 * Requires staff access (STAFF_USER_IDS) — space creation is an admin operation,
 * not something any authenticated user should be able to trigger.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { userId } = await auth()
    if (!userId) throw new UnauthorizedError('sign in required')
    if (!isStaff(userId, parseStaffIds(getEnv().STAFF_USER_IDS))) {
      throw new ForbiddenError('space creation requires staff access')
    }

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))
    const { slug, name } = parsed.data

    // Throws a clean 503 github_unconfigured if the App env isn't set yet.
    const { appId, privateKey, org, ownerType, visibility, allowUnprotected } = getGitHubConfig()

    // Pre-check the slug BEFORE we touch GitHub. `spaces.slug` is unique, so a
    // dup would otherwise fail only at the Neon insert — after the repo is
    // already provisioned — orphaning that repo and surfacing an opaque 500.
    if (await db.getSpaceBySlug(slug)) {
      throw new ConflictError(`a space with slug "${slug}" already exists`)
    }

    // A one-off App-JWT lookup (space creation is rare, staff-only), not worth
    // caching. The token exchange below IS cached — reused across every
    // read/write on every space (lib/github/singleton.ts).
    const installationId = await getInstallationId(appId, privateKey, org, ownerType)
    const token = await getInstallationTokenProvider().getToken(installationId)
    const gh = new GitHubClient(token)

    const repo = `teio-context-${slug}`
    const spaceYaml = renderSpaceYaml({ name, slug, owner: userId })
    const provisioning = await provisionSpaceRepo(gh, {
      owner: org,
      ownerType,
      repo,
      appId,
      spaceYaml,
      private: visibility === 'private',
      allowUnprotected,
    })

    // Register in Neon. If this fails, the repo was just created (only the
    // space.yaml seed) and would be orphaned — a retry with the same slug would
    // then hit a GitHub 422. Roll it back best-effort so create stays retryable.
    let space: Awaited<ReturnType<typeof db.createSpace>>
    try {
      space = await db.createSpace({
        slug,
        name,
        owner: org,
        repo,
        installationId,
        currentSha: provisioning.mainSha,
        createdBy: userId,
      })
    } catch (err) {
      await gh.request('DELETE', `/repos/${org}/${repo}`).catch(() => {})
      throw err
    }
    await db.addMember(space.id, 'user', userId, 'admin', userId)
    await db.insertAudit({ spaceId: space.id, actorType: 'user', actorId: userId, action: 'member_add', outcome: 'ok', requestId: getRequestId(req) })

    return Response.json({ space, provisioning }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}
