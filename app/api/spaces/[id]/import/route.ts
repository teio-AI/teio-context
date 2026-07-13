import { after } from 'next/server'
import { z } from 'zod'
import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { authorFor } from '@/lib/context/service'
import { MAX_IMPORT_FILES, seedFiles } from '@/lib/context/import'
import { ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { authzDeps, clientForSpace, getBotCommitter, repoRefForSpace } from '@/lib/wiring'

export const runtime = 'nodejs'
// GitHub calls scale with file count; give the background import room to run
// beyond the platform's default handler limit (Vercel Pro+; no-op elsewhere).
export const maxDuration = 300

const Body = z.object({
  files: z
    .array(z.object({ path: z.string().min(1), content: z.string() }))
    .min(1)
    .max(MAX_IMPORT_FILES),
})

/**
 * POST /api/spaces/:id/import — discover/import seeder (owner). Seeds a
 * space's context/ from a caller-supplied file set: one commit, chunked tree
 * creation (ARCHITECTURE §7.1 finding #13). Runs off the request path via
 * Next's `after()` — the response returns immediately; the caller detects
 * completion the same way they detect any other write: poll GET /version
 * until current_sha changes, or check audit via the space directly.
 *
 * Scope note: this imports a caller-supplied {path, content}[] payload, not
 * an arbitrary external git repo — crawling a third-party repo (auth, host,
 * recursive tree walking) is a larger, separately-scoped feature.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))
    const { files } = parsed.data

    for (const f of files) {
      if (f.path !== 'context' && !f.path.startsWith('context/')) {
        throw new ValidationError(`import path must be under context/: ${f.path}`)
      }
    }

    const { principal } = await requireSpaceAccess(req, id, 'owner', authzDeps)
    const requestId = getRequestId(req) // capture before the response returns; `req` outlives the handler in after()

    after(async () => {
      try {
        const repo = await repoRefForSpace(id)
        const gh = await clientForSpace(id)
        const { sha } = await seedFiles(gh, repo, files, { author: authorFor(principal), committer: getBotCommitter() })
        await db.setCurrentSha(id, sha)
        await db.insertAudit({
          spaceId: id,
          actorType: principal.type,
          actorId: principal.id,
          action: 'import',
          path: null,
          resultSha: sha,
          outcome: 'ok',
          requestId,
        })
      } catch {
        await db
          .insertAudit({ spaceId: id, actorType: principal.type, actorId: principal.id, action: 'import', path: null, outcome: 'error', requestId })
          .catch(() => {})
      }
    })

    return Response.json({ status: 'started', fileCount: files.length }, { status: 202 })
  } catch (err) {
    return toResponse(err)
  }
}
