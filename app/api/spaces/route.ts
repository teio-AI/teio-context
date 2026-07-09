import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import * as db from '@/db'
import { UnauthorizedError, ValidationError } from '@/lib/errors'
import { getEnv, getPrivateKey } from '@/lib/env'
import { InstallationTokenProvider, getOrgInstallationId } from '@/lib/github/app-auth'
import { GitHubClient } from '@/lib/github/client'
import { provisionSpaceRepo } from '@/lib/github/provision'
import { toResponse } from '@/lib/http'
import { renderSpaceYaml } from '@/lib/space-yaml'

export const runtime = 'nodejs'

const Body = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/, 'slug must be lowercase alphanumeric with dashes'),
  name: z.string().min(1).max(200),
})

/**
 * Create a space: provision the git repo (seed commit → PR-required ruleset with
 * App bypass) then register it in Neon and make the creator an owner.
 * Done-when criterion for Phase 1.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { userId } = await auth()
    if (!userId) throw new UnauthorizedError('sign in required')

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))
    const { slug, name } = parsed.data

    const env = getEnv()
    const key = getPrivateKey(env)
    const appId = Number(env.GITHUB_APP_ID)
    const org = env.GITHUB_ORG

    const installationId = await getOrgInstallationId(appId, key, org)
    const token = await new InstallationTokenProvider(appId, key).getToken(installationId)
    const gh = new GitHubClient(token)

    const repo = `teio-context-${slug}`
    const spaceYaml = renderSpaceYaml({ name, slug, owner: userId })
    const provisioning = await provisionSpaceRepo(gh, { owner: org, repo, appId, spaceYaml })

    const space = await db.createSpace({
      slug,
      name,
      owner: org,
      repo,
      installationId,
      currentSha: provisioning.mainSha,
      createdBy: userId,
    })
    await db.addMember(space.id, 'user', userId, 'owner', userId)
    await db.insertAudit({ spaceId: space.id, actorType: 'user', actorId: userId, action: 'member_add', outcome: 'ok' })

    return Response.json({ space, provisioning }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}
