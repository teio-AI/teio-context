import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { marked } from 'marked'

/**
 * Renders docs/onboarding.md (the single source) as HTML. Used by the public
 * landing page (`/`) and the standalone `/docs` page. Content is our own trusted
 * markdown, so marked → dangerouslySetInnerHTML is safe. The .md file is shipped
 * to the serverless function via `outputFileTracingIncludes` in next.config.mjs.
 */
export async function OnboardingArticle() {
  const md = readFileSync(join(process.cwd(), 'docs/onboarding.md'), 'utf8')
  const html = await marked.parse(md)
  return <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
}
