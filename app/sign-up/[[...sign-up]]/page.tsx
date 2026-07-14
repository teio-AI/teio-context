import { SignUp } from '@clerk/nextjs'

// Sign-up is needed to create the first admin account in a fresh Clerk instance.
// Tighten/remove once the real (Tarush) Clerk instance restricts registration.
export default function SignUpPage() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
      <SignUp />
    </main>
  )
}
