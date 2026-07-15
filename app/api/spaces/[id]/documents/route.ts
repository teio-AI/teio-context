import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { toResponse } from '@/lib/http'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

/**
 * GET /api/spaces/:id/documents — list the project's context documents
 * (path + title + snippet, from the derived index) so the UI can browse them.
 * Read the full body via GET /api/spaces/:id/context?path=… on a selection.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    await requireSpaceAccess(req, id, 'reader', authzDeps)
    return Response.json({ documents: await db.listDocuments(id) })
  } catch (err) {
    return toResponse(err)
  }
}
