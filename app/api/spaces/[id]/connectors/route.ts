import { NeonDbError } from '@neondatabase/serverless'
import { z } from 'zod'
import * as db from '@/db'
import { requireSpaceAccess } from '@/lib/auth/context'
import { defaultPolicyForKind } from '@/lib/connectors'
import { ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'
import { getRequestId } from '@/lib/request-id'
import { authzDeps } from '@/lib/wiring'

export const runtime = 'nodejs'

const Body = z.object({
  kind: z.enum(['mcp', 'teio', 'customer']),
  name: z.string().min(1).max(200),
  writeBackPolicy: z.enum(['auto_merge_clean', 'proposal_only', 'inherit']).optional(),
})

/** List connectors on a space (any member can view). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    await requireSpaceAccess(req, id, 'reader', authzDeps)
    return Response.json({ connectors: await db.listConnectors(id) })
  } catch (err) {
    return toResponse(err)
  }
}

/**
 * POST /api/spaces/:id/connectors — register a connector (owner). Write-back
 * policy defaults per kind when not given explicitly (ARCHITECTURE §3.1, §8:
 * mcp → proposal_only, teio → auto_merge_clean). `customer` has no spec'd v1
 * default (it's a v1.1 fast-follow) — the caller must specify one.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))
    const { kind, name } = parsed.data

    const { principal } = await requireSpaceAccess(req, id, 'admin', authzDeps)

    const writeBackPolicy = parsed.data.writeBackPolicy ?? defaultPolicyForKind(kind)
    if (!writeBackPolicy) throw new ValidationError(`writeBackPolicy is required for connector kind "${kind}"`)

    let connector
    try {
      connector = await db.createConnector({ spaceId: id, kind, name, writeBackPolicy })
    } catch (err) {
      if (err instanceof NeonDbError && err.code === '23505') {
        throw new ValidationError(`a connector named "${name}" already exists on this space`)
      }
      throw err
    }

    await db.insertAudit({
      spaceId: id,
      actorType: principal.type,
      actorId: principal.id,
      action: 'connector_add',
      path: null,
      outcome: 'ok',
      requestId: getRequestId(req),
    })

    return Response.json({ connector }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}
