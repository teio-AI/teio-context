import { auth } from '@clerk/nextjs/server'
import { getEnv } from '@/lib/env'
import { isStaff, parseStaffIds } from '@/lib/auth/staff'
import { UnauthorizedError } from '@/lib/errors'
import { toResponse } from '@/lib/http'

export const runtime = 'nodejs'

/** GET /api/me — the signed-in Clerk user + whether they can create projects (staff). */
export async function GET(): Promise<Response> {
  try {
    const { userId } = await auth()
    if (!userId) throw new UnauthorizedError('sign in required')
    return Response.json({ userId, isStaff: isStaff(userId, parseStaffIds(getEnv().STAFF_USER_IDS)) })
  } catch (err) {
    return toResponse(err)
  }
}
