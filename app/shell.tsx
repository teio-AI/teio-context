'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { SignOutButton, useUser } from '@clerk/nextjs'

/** App chrome: sidebar nav + user footer, wrapping every signed-in page. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? ''
  const { user } = useUser()
  const onProjects = path === '/dashboard' || path.startsWith('/spaces/')

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          teiō <span>context</span>
        </div>
        <nav className="nav">
          <div className="nav-label">Workspace</div>
          <a className={`nav-item${onProjects ? ' active' : ''}`} href="/dashboard">
            Projects
          </a>
          <a className={`nav-item${path === '/settings' ? ' active' : ''}`} href="/settings">
            Settings
          </a>
          <a className={`nav-item${path === '/docs' ? ' active' : ''}`} href="/docs">
            Docs
          </a>
        </nav>
        <div className="sidebar-foot">
          <div className="user-email">{user?.primaryEmailAddress?.emailAddress ?? '…'}</div>
          {user?.id && (
            <div className="faint" style={{ fontSize: 10, marginBottom: 8, userSelect: 'all', wordBreak: 'break-all' }} title="Your user id (for STAFF_USER_IDS bootstrap)">
              {user.id}
            </div>
          )}
          <SignOutButton>
            <button type="button" className="btn btn-sm" style={{ width: '100%' }}>
              Sign out
            </button>
          </SignOutButton>
        </div>
      </aside>
      <main className="main">
        <div className="page">{children}</div>
      </main>
    </div>
  )
}
