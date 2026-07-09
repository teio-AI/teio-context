import { after } from 'next/server'
import * as db from '@/db'
import { getEnv } from '@/lib/env'
import { verifyWebhookSignature } from '@/lib/github/webhook'
import { reindexChangedPaths } from '@/lib/context/reindex'
import { clientForSpace, repoRefForSpace } from '@/lib/wiring'

export const runtime = 'nodejs'
export const maxDuration = 300

interface PushPayload {
  ref: string
  after: string
  repository: { name: string; owner: { login?: string; name?: string } }
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[]
}

interface PullRequestPayload {
  action: string
  number: number
  pull_request: { merged?: boolean; merged_by?: { login: string } | null }
  repository: { name: string; owner: { login?: string; name?: string } }
  sender?: { login: string }
}

function repoOwner(p: { owner: { login?: string; name?: string } }): string {
  return p.owner.login ?? p.owner.name ?? ''
}

/**
 * GitHub webhook sink (ARCHITECTURE §6). Authenticated by HMAC signature — NOT
 * Clerk/token. Acks fast (202) and does the reindex/reconcile work in `after()`.
 * Idempotent: a redelivered X-GitHub-Delivery is recorded once and skipped.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = getEnv().GITHUB_WEBHOOK_SECRET
  if (!secret) return Response.json({ error: 'webhook_unconfigured' }, { status: 503 })

  const raw = await req.text()
  if (!verifyWebhookSignature(secret, raw, req.headers.get('x-hub-signature-256'))) {
    return Response.json({ error: 'bad_signature' }, { status: 401 })
  }

  const event = req.headers.get('x-github-event') ?? ''
  const deliveryId = req.headers.get('x-github-delivery') ?? ''
  if (!deliveryId) return Response.json({ error: 'missing_delivery_id' }, { status: 400 })

  const isNew = await db.recordDelivery(deliveryId, event)
  if (!isNew) return Response.json({ status: 'duplicate_ignored' }, { status: 200 })

  const payload = JSON.parse(raw) as unknown

  if (event === 'push') {
    const p = payload as PushPayload
    after(() => handlePush(p).catch(() => {}))
  } else if (event === 'pull_request') {
    const p = payload as PullRequestPayload
    after(() => handlePullRequest(p).catch(() => {}))
  }
  // Any other event is acked and ignored.

  return Response.json({ status: 'accepted' }, { status: 202 })
}

async function handlePush(p: PushPayload): Promise<void> {
  const space = await db.getSpaceByRepo(repoOwner(p.repository), p.repository.name)
  if (!space) return
  if (p.ref !== `refs/heads/${space.default_branch}`) return // only the default branch matters
  if (space.current_sha === p.after) return // already processed this head

  const upserted = new Set<string>()
  const removed = new Set<string>()
  for (const c of p.commits ?? []) {
    for (const path of [...(c.added ?? []), ...(c.modified ?? [])]) upserted.add(path)
    for (const path of c.removed ?? []) removed.add(path)
  }
  // A path both modified and later removed in the same push → treat as removed.
  for (const path of removed) upserted.delete(path)

  const repo = await repoRefForSpace(space.id)
  const gh = await clientForSpace(space.id)
  await reindexChangedPaths(gh, repo, space.id, { upserted: [...upserted], removed: [...removed] }, p.after)

  await db.setCurrentSha(space.id, p.after)
  await db.markCursorsStale(space.id)
  await db.insertAudit({ spaceId: space.id, actorType: 'github', action: 'reindex', path: null, resultSha: p.after, outcome: 'ok' })
}

async function handlePullRequest(p: PullRequestPayload): Promise<void> {
  if (p.action !== 'closed') return
  const space = await db.getSpaceByRepo(repoOwner(p.repository), p.repository.name)
  if (!space) return

  const status = p.pull_request.merged ? 'merged' : 'closed'
  const proposal = await db.resolveProposalByPr(space.id, p.number, status)
  if (!proposal) return

  // The human who merged the PR is the authoritative approver for this write
  // (ARCHITECTURE §6 finding #7) — the direct-write audit row can't capture it.
  const approver = p.pull_request.merged_by?.login ?? p.sender?.login ?? null
  await db.insertAudit({
    spaceId: space.id,
    actorType: 'github',
    actorDisplay: approver,
    action: status === 'merged' ? 'pr_merged' : 'pr_closed',
    path: proposal.path,
    outcome: 'ok',
  })
}
