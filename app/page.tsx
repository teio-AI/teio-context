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
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <div className="card card-pad" style={{ maxWidth: 460, width: '100%' }}>
        <div className="brand" style={{ padding: 0, border: 'none', marginBottom: 6 }}>
          teiō <span>context</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>Shared context layer — canonical context lives in git; this is the control plane.</p>

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' }} />

        {userId ? (
          <div className="stack">
            <div>
              <div className="faint">Signed in as</div>
              <code>{userId}</code>
            </div>
            <div>
              Space creation (Owner):{' '}
              {staff ? <span className="tag tag-admin">allowed ✓</span> : <span className="neg">denied — add this id to STAFF_USER_IDS</span>}
            </div>
            <div className="row">
              <a className="btn btn-primary" href="/dashboard">Open dashboard →</a>
              <SignOutButton>
                <button type="button" className="btn">Sign out</button>
              </SignOutButton>
            </div>
          </div>
        ) : (
          <div className="row">
            <a className="btn btn-primary" href="/sign-in">Sign in</a>
            <a className="btn" href="/sign-up">Sign up</a>
          </div>
        )}
      </div>
    </main>
  )
}
