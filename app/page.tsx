import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { OnboardingArticle } from './onboarding-article'

// Reads the Clerk session server-side, so it renders dynamically.
export const dynamic = 'force-dynamic'

export default async function Home() {
  const { userId } = await auth()
  if (userId) redirect('/dashboard')

  // Signed-out landing = the onboarding guide + a Sign in in the header.
  // Sign-up is reached from Clerk's sign-in page, so no separate button here.
  return (
    <div className="docs-shell">
      <header className="docs-head">
        <div className="brand">
          teiō <span>context</span>
        </div>
        <a className="btn btn-primary btn-sm" href="/sign-in">
          Sign in
        </a>
      </header>
      <OnboardingArticle />
    </div>
  )
}
