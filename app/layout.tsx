import type { ReactNode } from 'react'
import { ClerkProvider } from '@clerk/nextjs'

export const metadata = {
  title: 'teio-context',
  description: 'Lightweight shared-context layer',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
