import { OnboardingArticle } from '../onboarding-article'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

export const metadata = {
  title: 'teio-context — onboarding',
  description: 'How to set up and use teio-context shared context.',
}

/** Public, standalone onboarding page (shareable URL). Renders docs/onboarding.md. */
export default function DocsPage() {
  return (
    <div className="docs-shell">
      <header className="docs-head">
        <div className="brand">
          teiō <span>context</span>
        </div>
        <a className="btn btn-sm" href="/dashboard">
          Open dashboard
        </a>
      </header>
      <OnboardingArticle />
    </div>
  )
}
