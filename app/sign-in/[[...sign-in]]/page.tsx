import { SignIn } from '@clerk/nextjs'

// Clerk path-routed sign-in (catch-all). The human admin surface (create spaces,
// manage members/tokens) is gated by a Clerk session; this is where staff land.
export default function SignInPage() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
      <SignIn fallbackRedirectUrl="/dashboard" signUpUrl="/sign-up" />
    </main>
  )
}
