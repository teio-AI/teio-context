import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

// Reads the Clerk session server-side, so it renders dynamically.
export const dynamic = 'force-dynamic'

export default async function Home() {
  const { userId } = await auth()
  if (userId) redirect('/dashboard')

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <div className="card card-pad" style={{ maxWidth: 460, width: '100%' }}>
        <div className="brand" style={{ padding: 0, border: 'none', marginBottom: 6 }}>
          teiō <span>context</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Shared context layer — canonical context lives in git; this is the control plane.
        </p>
        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' }} />
        <div className="row">
          <a className="btn btn-primary" href="/sign-in">Sign in</a>
          <a className="btn" href="/sign-up">Sign up</a>
        </div>
      </div>
    </main>
  )
}
