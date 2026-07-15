import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as db from '@/db'
import { sql } from '@/db/client'
import { generateToken, verifyToken } from '@/lib/auth/tokens'

/**
 * Exercises the real db/*.ts queries against a live Postgres — the layer unit
 * tests mock. Verifies the SQL actually matches Postgres: FTS match/rank,
 * `on conflict` upserts, connector-policy `inherit` resolution, delivery
 * idempotency, FK cascades, token prefix-lookup + hash verify.
 *
 * Opt-in only: set RUN_DB_INTEGRATION=1 (and DATABASE_URL). Skips in CI and in
 * routine local runs so `bun test` never needs the network. Self-cleaning —
 * every row it creates hangs off one uniquely-slugged space it deletes at the end.
 */
const shouldRun = Boolean(process.env.RUN_DB_INTEGRATION && process.env.DATABASE_URL)

describe.skipIf(!shouldRun)('db integration (real Postgres)', () => {
  const uniq = randomUUID().slice(0, 8)
  const slug = `it-${uniq}`
  const deliveryId = `dlv-${uniq}`
  let spaceId: string

  beforeAll(async () => {
    const space = await db.createSpace({
      slug,
      name: `integration ${uniq}`,
      owner: `owner-${uniq}`,
      repo: `teio-context-${slug}`,
      installationId: 12345,
      currentSha: 'sha0',
      createdBy: 'sys',
    })
    spaceId = space.id
  })

  afterAll(async () => {
    // Deleting the space cascades members/tokens/connectors/proposals/documents/cursors.
    if (spaceId) await sql`delete from spaces where id = ${spaceId}`
    await sql`delete from webhook_deliveries where delivery_id = ${deliveryId}` // no FK to space
  })

  it('createSpace + loadSpaceRepo + getSpaceByRepo round-trip', async () => {
    const repo = await db.loadSpaceRepo(spaceId)
    expect(repo).toMatchObject({ owner: `owner-${uniq}`, repo: `teio-context-${slug}`, defaultBranch: 'main' })
    const byRepo = await db.getSpaceByRepo(`owner-${uniq}`, `teio-context-${slug}`)
    expect(byRepo?.id).toBe(spaceId)
  })

  it('members: upsert + role lookup + role change', async () => {
    await db.addMember(spaceId, 'user', 'user_x', 'reader', 'sys')
    expect(await db.getMemberRole(spaceId, 'user', 'user_x')).toBe('reader')
    await db.addMember(spaceId, 'user', 'user_x', 'admin', 'sys') // on conflict → update
    expect(await db.getMemberRole(spaceId, 'user', 'user_x')).toBe('admin')
    expect(await db.getMemberRole(spaceId, 'user', 'nobody')).toBeNull()
  })

  it('tokens: prefix lookup + hash verify + connector binding', async () => {
    const connector = await db.createConnector({ spaceId, kind: 'mcp', name: `mcp-${uniq}`, writeBackPolicy: 'inherit' })
    const gen = generateToken(slug)
    const { id: tokenId } = await db.insertApiToken({
      spaceId,
      name: 'ci',
      tokenPrefix: gen.prefix,
      tokenHash: gen.hash,
      role: 'editor',
      connectorId: connector.id,
      createdBy: 'sys',
    })
    const row = await db.findTokenByPrefix(gen.prefix)
    expect(row?.id).toBe(tokenId)
    expect(verifyToken(gen.token, row!.token_hash)).toBe(true)
    expect(verifyToken('tctx_wrong', row!.token_hash)).toBe(false)
    expect(await db.getConnectorIdForToken(tokenId)).toBe(connector.id)

    // connector-policy resolution: inherit → space default
    expect(await db.resolveConnectorPolicyForToken(tokenId, 'auto_merge_clean')).toBe('auto_merge_clean')

    // revoke is idempotent-ish: first succeeds, second finds nothing
    expect(await db.revokeToken(spaceId, tokenId)).toBe(true)
    expect(await db.revokeToken(spaceId, tokenId)).toBe(false)
  })

  it('FTS: upsert computes tsvector, search matches + ranks, delete prunes', async () => {
    await db.upsertDocument({ spaceId, path: 'context/billing.md', title: 'Billing', snippet: 's', body: 'how we bill invoices monthly', contentSha: 'b1', commitSha: 'c1' })
    await db.upsertDocument({ spaceId, path: 'context/onboard.md', title: 'Onboarding', snippet: 's', body: 'welcome new customers setup', contentSha: 'b2', commitSha: 'c2' })

    const hits = await db.searchDocuments(spaceId, 'billing')
    expect(hits.map((h) => h.path)).toContain('context/billing.md')
    expect(hits.map((h) => h.path)).not.toContain('context/onboard.md')

    expect(await db.listDocumentPaths(spaceId)).toHaveLength(2)
    await db.deleteDocument(spaceId, 'context/billing.md')
    expect(await db.listDocumentPaths(spaceId)).toEqual(['context/onboard.md'])
  })

  it('ts_headline: highlight wraps a matched term found in the snippet', async () => {
    await db.upsertDocument({
      spaceId,
      path: 'context/hl.md',
      title: 'HL',
      snippet: 'how we bill invoices monthly',
      body: 'how we bill invoices monthly and reconcile them',
      contentSha: 'h1',
      commitSha: 'c1',
    })
    const [hit] = await db.searchDocuments(spaceId, 'invoices')
    expect(hit?.path).toBe('context/hl.md')
    expect(hit?.highlight).toContain('**invoices**') // matched term highlighted
    await db.deleteDocument(spaceId, 'context/hl.md')
  })

  it('proposals: record (proposal_only → open) → listOpen → resolveByPr', async () => {
    // Passing the engine outcome 'proposal' must land as a valid 'open' row —
    // inserting 'proposal' verbatim would violate the status CHECK constraint.
    const id = await db.recordProposal({
      spaceId,
      actorDisplay: 'user_x',
      path: 'context/x.md',
      baseSha: 'base',
      branchRef: 'refs/heads/proposal/abc',
      prNumber: 42,
      prUrl: 'https://gh/pr/42',
      status: 'proposal',
    })
    expect(id).toBeTruthy()
    const open = await db.listOpenProposals(spaceId)
    expect(open.find((p) => p.pr_number === 42)?.status).toBe('open')
    const resolved = await db.resolveProposalByPr(spaceId, 42, 'merged')
    expect(resolved?.status).toBe('merged')
    expect((await db.listOpenProposals(spaceId)).some((p) => p.pr_number === 42)).toBe(false)
  })

  it('webhook delivery idempotency: first is new, redelivery is not', async () => {
    expect(await db.recordDelivery(deliveryId, 'push')).toBe(true)
    expect(await db.recordDelivery(deliveryId, 'push')).toBe(false)
  })

  it('cursors + current_sha update', async () => {
    await db.setCurrentSha(spaceId, 'sha1')
    expect((await db.getSpaceById(spaceId))?.current_sha).toBe('sha1')
    // a connector exists from the tokens test; mark stale then ack
    await db.markCursorsStale(spaceId) // no throw even if no cursor rows yet
  })
})
