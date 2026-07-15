import { auth, currentUser } from '@clerk/nextjs/server'
import * as db from '@/db'
import { getEnv } from '@/lib/env'
import { isStaff, parseStaffIds } from '@/lib/auth/staff'
import { UnauthorizedError } from '@/lib/errors'
import { toResponse } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/me — the signed-in user + whether they're an Owner (staff, can create
 * spaces). Also RECONCILES pending email invitations: any invite addressed to one
 * of this user's *verified* emails becomes a real membership here (so accepting an
 * invite = just signing up / logging in). Called on dashboard load.
 */
export async function GET(): Promise<Response> {
  try {
    const { userId } = await auth()
    if (!userId) throw new UnauthorizedError('sign in required')

    const user = await currentUser()
    const verifiedEmails = (user?.emailAddresses ?? [])
      .filter((e) => e.verification?.status === 'verified')
      .map((e) => e.emailAddress)

    const joined: { spaceId: string; role: string }[] = []
    for (const email of verifiedEmails) {
      for (const inv of await db.listPendingForEmail(email)) {
        await db.addMember(inv.space_id, 'user', userId, inv.role, inv.invited_by)
        await db.deletePendingInvitationById(inv.id)
        joined.push({ spaceId: inv.space_id, role: inv.role })
      }
    }

    return Response.json({
      userId,
      isStaff: isStaff(userId, parseStaffIds(getEnv().STAFF_USER_IDS)),
      joined,
    })
  } catch (err) {
    return toResponse(err)
  }
}
