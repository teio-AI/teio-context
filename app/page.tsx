import { auth } from '@clerk/nextjs/server'
import { SignOutButton } from '@clerk/nextjs'
import { getEnv } from '@/lib/env'
import { isStaff, parseStaffIds } from '@/lib/auth/staff'

// Reads the Clerk session server-side, so it renders dynamically (no build-time
// prerender / env access).
export const dynamic = 'force-dynamic'

export default async function Home() {
  const { userId } = await auth()
  const staff = userId ? isStaff(userId, parseStaffIds(getEnv().STAFF_USER_IDS)) : false

  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 640, lineHeight: 1.5 }}>
      <h1>teio-context</h1>
      <p>Shared context layer. Canonical context lives in git; this is the control plane.</p>
      <p>
        Health: <code>/api/health</code>
      </p>

      <hr style={{ margin: '1.5rem 0', border: 0, borderTop: '1px solid #ddd' }} />

      {userId ? (
        <>
          <p>
            Signed in as <code>{userId}</code>
          </p>
          <p>
            Space creation (staff): <strong>{staff ? 'allowed ✓' : 'denied — add this id to STAFF_USER_IDS'}</strong>
          </p>
          <p>
            <a href="/dashboard">→ Open dashboard</a>
          </p>
          <SignOutButton>
            <button type="button" style={{ padding: '0.4rem 0.9rem', cursor: 'pointer' }}>
              Sign out
            </button>
          </SignOutButton>
        </>
      ) : (
        <p>
          <a href="/sign-in">Sign in</a> · <a href="/sign-up">Sign up</a>
        </p>
      )}
    </main>
  )
}
