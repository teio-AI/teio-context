import { SignUp } from '@clerk/nextjs'

// Sign-up is needed to create the first admin account in a fresh Clerk instance.
// Tighten/remove once the real (Tarush) Clerk instance restricts registration.
export default function SignUpPage() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
      {/* Accepting an email invite lands here with a __clerk_ticket; <SignUp>
          consumes it to create the account, then we go to the dashboard where
          the pending invitation is reconciled into a membership. */}
      <SignUp fallbackRedirectUrl="/dashboard" signInUrl="/sign-in" />
    </main>
  )
}
