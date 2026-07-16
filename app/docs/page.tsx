import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { marked } from 'marked'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

export const metadata = {
  title: 'teio-context — onboarding',
  description: 'How to set up and use teio-context shared context.',
}

/**
 * Public onboarding page. Renders docs/onboarding.md (the single source, also
 * readable in the repo) at build time. Content is our own trusted markdown, so
 * marked → dangerouslySetInnerHTML is safe here.
 */
export default async function DocsPage() {
  const md = readFileSync(join(process.cwd(), 'docs/onboarding.md'), 'utf8')
  const html = await marked.parse(md)

  return (
    <div className="docs-shell">
      <header className="docs-head">
        <div className="brand">
          teiō <span>context</span>
        </div>
        <a className="btn btn-sm" href="https://teio-context.vercel.app/dashboard">
          Open dashboard
        </a>
      </header>
      <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
