import { after } from 'next/server'
import * as db from '@/db'
import { getEnv } from '@/lib/env'
import { getBranchHead } from '@/lib/github/git-data'
import { reindexAll } from '@/lib/context/reindex'
import { clientForSpace, repoRefForSpace } from '@/lib/wiring'
import type { GitHubApi } from '@/lib/github/client'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Reconciliation cron (ARCHITECTURE §6, §7.1) — catches dropped webhooks. For
 * each active space: if the real HEAD drifted from current_sha, full-reindex
 * and bump. Also reconciles open proposals against their PR state (a dropped
 * pull_request webhook otherwise leaves 'open' rows forever) and GCs the
 * branch of a resolved proposal (orphan-branch cleanup, §13 TODO 3).
 *
 * Auth: a shared CRON_SECRET bearer. Vercel Cron invokes with GET and (when
 * CRON_SECRET is set in the project env) sends `Authorization: Bearer $CRON_SECRET`.
 * Acks fast and does the work in after() so the invocation returns promptly.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET
  if (!secret) return Response.json({ error: 'cron_unconfigured' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  after(() => runBackfill().catch(() => {}))
  return Response.json({ status: 'started' }, { status: 202 })
}

async function runBackfill(): Promise<void> {
  for (const space of await db.listActiveSpaces()) {
    try {
      const repo = await repoRefForSpace(space.id)
      const gh = await clientForSpace(space.id)

      const head = await getBranchHead(gh, repo)
      if (head !== space.current_sha) {
        await reindexAll(gh, repo, space.id, head)
        await db.setCurrentSha(space.id, head)
        await db.markCursorsStale(space.id)
        await db.insertAudit({ spaceId: space.id, actorType: 'github', action: 'backfill', path: null, resultSha: head, outcome: 'ok' })
      }

      await reconcileProposals(gh, repo, space.id)
    } catch {
      await db
        .insertAudit({ spaceId: space.id, actorType: 'github', action: 'backfill', path: null, outcome: 'error' })
        .catch(() => {})
    }
  }
}

async function reconcileProposals(gh: GitHubApi, repo: { owner: string; repo: string }, spaceId: string): Promise<void> {
  for (const proposal of await db.listOpenProposals(spaceId)) {
    if (proposal.pr_number == null) continue
    const pr = await gh.request<{ state: string; merged: boolean }>(
      'GET',
      `/repos/${repo.owner}/${repo.repo}/pulls/${proposal.pr_number}`,
    )
    if (pr.data.state !== 'closed') continue
    await db.resolveProposalByPr(spaceId, proposal.pr_number, pr.data.merged ? 'merged' : 'closed')
    // Orphan-branch GC: the PR is resolved, so its proposal branch is dead.
    // branch_ref is `refs/heads/…`; DELETE /git/refs/{ref} wants `git/refs/heads/…`.
    await gh.request('DELETE', `/repos/${repo.owner}/${repo.repo}/git/${proposal.branch_ref}`).catch(() => {})
  }
}
