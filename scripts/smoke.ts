// Machine-token smoke test against a running deployment (staging or prod).
// Exercises the full share-OUT → update-IN → read-back round trip that unit
// tests (which mock GitHub/Neon) can't: real Neon, real GitHub App, real merge.
//
//   TEIO_CONTEXT_API_URL=https://<domain> \
//   TEIO_CONTEXT_TOKEN=<editor token> \
//   TEIO_CONTEXT_SPACE=<space id> \
//   bun run smoke
//
// Needs an EDITOR-role machine token (issue via POST /api/spaces/:id/tokens).
import { TeioContextClient } from '../packages/teio-client'

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`missing env: ${name}`)
    process.exit(1)
  }
  return v
}

const baseUrl = required('TEIO_CONTEXT_API_URL')
const token = required('TEIO_CONTEXT_TOKEN')
const spaceId = required('TEIO_CONTEXT_SPACE')

const client = new TeioContextClient(baseUrl, token)
const path = `context/smoke-${Date.now()}.md`
const step = (n: string) => console.log(`\n▶ ${n}`)

try {
  step('listSpaces (does the token resolve + authorize?)')
  console.log(await client.listSpaces())

  step('getVersion (read the current HEAD)')
  const before = await client.getVersion(spaceId)
  console.log(before)

  step(`proposeUpdate ${path} (write path: CAS → merge or PR)`)
  const write = await client.proposeUpdate(spaceId, { path, content: `# Smoke\n\nWritten at ${new Date().toISOString()}\n` })
  console.log(write)

  if (write.status === 'merged') {
    step('getDocument (read back the merged write)')
    const doc = await client.getDocument(spaceId, path)
    console.log({ version: doc.version, blob: doc.blob, contentPreview: doc.content.slice(0, 60) })

    step('getVersion (HEAD advanced?)')
    const after = await client.getVersion(spaceId)
    console.log({ before: before.sha, after: after.sha, advanced: after.sha !== before.sha })
  } else {
    step('write opened a PR (proposal_only or conflict) — check it in GitHub')
    console.log(write)
  }

  step('search "smoke" (FTS index — may lag until the webhook reindexes)')
  console.log(await client.search(spaceId, 'smoke'))

  console.log('\n✅ smoke test completed')
} catch (err) {
  console.error('\n❌ smoke test failed:', err instanceof Error ? err.message : err)
  process.exit(1)
}
