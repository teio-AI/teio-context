import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import * as db from '@/db'
import { generateToken } from '@/lib/auth/tokens'
import { UnauthorizedError, ValidationError } from '@/lib/errors'
import { toResponse } from '@/lib/http'

export const runtime = 'nodejs'

/** GET /api/me/tokens — the current user's PERSONAL tokens (metadata; no secret). */
export async function GET(): Promise<Response> {
  try {
    const { userId } = await auth()
    if (!userId) throw new UnauthorizedError('sign in required')
    return Response.json({ tokens: await db.listPersonalTokens(userId) })
  } catch (err) {
    return toResponse(err)
  }
}

const Body = z.object({ name: z.string().min(1).max(200) })

/**
 * POST /api/me/tokens — mint a PERSONAL access token. It authenticates as you
 * across every project you can access (no per-project token, no swapping). Shown
 * once. Configure your MCP server with it and pick a project via `/teio-start <slug>`.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { userId } = await auth()
    if (!userId) throw new UnauthorizedError('sign in required')
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '))

    const gen = generateToken('me')
    const { id } = await db.insertApiToken({
      spaceId: null, // personal → unbound
      name: parsed.data.name,
      tokenPrefix: gen.prefix,
      tokenHash: gen.hash,
      role: null,
      userId,
      createdBy: userId,
    })
    return Response.json({ id, token: gen.token, prefix: gen.prefix }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}
