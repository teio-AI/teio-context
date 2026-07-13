import { z } from 'zod'
import * as db from '@/db'
import { assertSafePath, requiredRoleForPath } from '@/lib/auth/authorize'
import { requireSpaceAccess } from '@/lib/auth/context'
import { ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import type { WriteResult } from '@/lib/context/types'
import { authzDeps, getContextService } from '@/lib/wiring'

export const runtime = 'nodejs'

const PostBody = z.object({
  path: z.string().min(1),
  content: z.string(),
  base_version: z.string().optional(),
  base_blob: z.string().optional(),
})

/** merged → 200; proposal/conflict (a PR was opened, pending human action) → 202. */
function writeResponse(result: WriteResult): Response {
  return Response.json(result, { status: result.status === 'merged' ? 200 : 202 })
}

/**
 * GET /api/spaces/:id/context?path=… — the share-OUT read path. Returns
 * content + version (commit SHA) + blob (round-trip as base_blob for the CAS
 * fast path).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const path = new URL(req.url).searchParams.get('path')
    if (!path) throw new ValidationError('query param "path" is required')
    assertSafePath(path) // reads must not traverse out of the repo either

    const { principal } = await requireSpaceAccess(req, id, 'reader', authzDeps)
    const doc = await getContextService().getDocument(principal, id, path)

    await db
      .insertAudit({ spaceId: id, actorType: principal.type, actorId: principal.id, action: 'read', path, outcome: 'ok' })
      .catch(() => {})

    return Response.json(doc)
  } catch (err) {
    return toResponse(err)
  }
}

/**
 * POST /api/spaces/:id/context — the update-IN write path. Role is path-derived:
 * editor for context/**, owner for space.yaml (requiredRoleForPath, finding #12).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const parsed = PostBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))
    const { path, content, base_version, base_blob } = parsed.data

    const { principal } = await requireSpaceAccess(req, id, requiredRoleForPath(path), authzDeps)
    const result = await getContextService().proposeUpdate(principal, id, {
      path,
      content,
      baseVersion: base_version,
      baseBlob: base_blob,
    })
    return writeResponse(result)
  } catch (err) {
    return toResponse(err)
  }
}

/** DELETE /api/spaces/:id/context?path=…&base_version=… — remove a path. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const url = new URL(req.url)
    const path = url.searchParams.get('path')
    if (!path) throw new ValidationError('query param "path" is required')
    const baseVersion = url.searchParams.get('base_version') ?? undefined

    const { principal } = await requireSpaceAccess(req, id, requiredRoleForPath(path), authzDeps)
    const result = await getContextService().deletePath(principal, id, { path, baseVersion })
    return writeResponse(result)
  } catch (err) {
    return toResponse(err)
  }
}
