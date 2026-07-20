// =============================================================================
// teiō context — MCP connector (Streamable HTTP, stateless), DUAL AUTH.
// =============================================================================
// One endpoint (/api/mcp) serves both client shapes:
//   • Claude Code plugin / terminal → Authorization: Bearer tctx_… (personal or
//     service token) — resolved via resolvePrincipal.
//   • claude.ai / desktop Connector → OAuth "individual sign-in" via Clerk —
//     verified with verifyClerkToken; the .well-known routes advertise Clerk as
//     the authorization server.
// Tools run against the service layer as the resolved principal, authorized with
// the exact same space-role logic as the REST routes (authorizeResolved).
// Stateless: each call re-verifies the token and re-resolves access.
// =============================================================================
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { auth } from '@clerk/nextjs/server'
import { verifyClerkToken } from '@clerk/mcp-tools/next'
import { z } from 'zod'
import * as db from '@/db'
import { authorizeResolved, resolvePrincipal, type ResolvedAuth } from '@/lib/auth/context'
import { assertSafePath, higherRole, requiredRoleForPath } from '@/lib/auth/authorize'
import { parseStaffEmails } from '@/lib/auth/staff'
import { getEnv } from '@/lib/env'
import { fetchUserEmails } from '@/lib/invitations'
import { authzDeps, getContextService } from '@/lib/wiring'

export const runtime = 'nodejs'
export const maxDuration = 60

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}
function errorResult(err: unknown) {
  return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true }
}
// The ResolvedAuth stashed by the auth wrapper (below) travels on authInfo.extra.
function resolvedFrom(extra: unknown): ResolvedAuth {
  const r = (extra as { authInfo?: { extra?: { resolved?: ResolvedAuth } } })?.authInfo?.extra?.resolved
  if (!r) throw new Error('not authenticated')
  return r
}

const spaceId = z.string().describe('The space id (from list_spaces).')

const handler = createMcpHandler(
  (server) => {
    server.registerTool('list_spaces', { description: 'List the context spaces you can access.' }, async (extra) => {
      try { return textResult(await getContextService().listSpaces(resolvedFrom(extra).principal)) } catch (e) { return errorResult(e) }
    })

    server.registerTool('get_version', { description: 'Get the current version (commit SHA) of a space.', inputSchema: { spaceId } }, async ({ spaceId }, extra) => {
      try { const r = resolvedFrom(extra); await authorizeResolved(r, spaceId, 'reader', authzDeps); return textResult(await getContextService().getVersion(r.principal, spaceId)) } catch (e) { return errorResult(e) }
    })

    server.registerTool('get_document', { description: 'Read a document. Returns content, version (commit SHA), and blob (for later writes).', inputSchema: { spaceId, path: z.string().describe('Path within the space, e.g. context/overview.md') } }, async ({ spaceId, path }, extra) => {
      try {
        assertSafePath(path)
        const r = resolvedFrom(extra)
        await authorizeResolved(r, spaceId, 'reader', authzDeps)
        const doc = await getContextService().getDocument(r.principal, spaceId, path)
        await db.insertAudit({ spaceId, actorType: r.principal.type, actorId: r.principal.id, action: 'read', path, outcome: 'ok' }).catch(() => {})
        return textResult(doc)
      } catch (e) { return errorResult(e) }
    })

    server.registerTool('search', { description: 'Keyword search over a space’s documents. Returns path + snippet.', inputSchema: { spaceId, query: z.string().describe('Free-text search query.') } }, async ({ spaceId, query }, extra) => {
      try { const r = resolvedFrom(extra); await authorizeResolved(r, spaceId, 'reader', authzDeps); return textResult(await getContextService().search(r.principal, spaceId, query)) } catch (e) { return errorResult(e) }
    })

    server.registerTool('list_proposals', { description: 'List open pull requests (proposals + conflicts) awaiting a human in a space.', inputSchema: { spaceId } }, async ({ spaceId }, extra) => {
      try { const r = resolvedFrom(extra); await authorizeResolved(r, spaceId, 'reader', authzDeps); return textResult(await getContextService().listProposals(r.principal, spaceId)) } catch (e) { return errorResult(e) }
    })

    server.registerTool('propose_update', {
      description: 'Propose a change to a document (creates it if it does not exist). A clean edit may auto-merge; otherwise it opens a pull request. Pass baseVersion and baseBlob from a prior get_document when editing an existing file.',
      inputSchema: { spaceId, path: z.string().describe('Path within the space, e.g. context/overview.md'), content: z.string().describe('Full new content (UTF-8, max 1 MiB).'), baseVersion: z.string().optional().describe('version SHA from get_document.'), baseBlob: z.string().optional().describe('blob SHA from get_document (enables the fast merge path).') },
    }, async ({ spaceId, path, content, baseVersion, baseBlob }, extra) => {
      try { const r = resolvedFrom(extra); await authorizeResolved(r, spaceId, requiredRoleForPath(path), authzDeps); return textResult(await getContextService().proposeUpdate(r.principal, spaceId, { path, content, baseVersion, baseBlob })) } catch (e) { return errorResult(e) }
    })

    server.registerTool('delete_path', { description: 'Delete a document from a space. May open a pull request instead, per policy.', inputSchema: { spaceId, path: z.string().describe('Path to delete.'), baseVersion: z.string().optional() } }, async ({ spaceId, path, baseVersion }, extra) => {
      try { const r = resolvedFrom(extra); await authorizeResolved(r, spaceId, requiredRoleForPath(path), authzDeps); return textResult(await getContextService().deletePath(r.principal, spaceId, { path, baseVersion })) } catch (e) { return errorResult(e) }
    })

    server.registerTool('move_path', { description: 'Rename or move a document within a space (a true rename).', inputSchema: { spaceId, from: z.string().describe('Current path.'), to: z.string().describe('New path.'), baseVersion: z.string().optional() } }, async ({ spaceId, from, to, baseVersion }, extra) => {
      try { const r = resolvedFrom(extra); await authorizeResolved(r, spaceId, higherRole(requiredRoleForPath(from), requiredRoleForPath(to)), authzDeps); return textResult(await getContextService().movePath(r.principal, spaceId, { from, to, baseVersion })) } catch (e) { return errorResult(e) }
    })
  },
  {},
  { basePath: '/api', maxDuration: 60 },
)

/** Reconcile STAFF_EMAILS → global owner for an OAuth user (who may never have hit the web /api/me). */
async function reconcileOwnerFromEmail(userId: string): Promise<void> {
  const env = getEnv()
  if (!env.CLERK_SECRET_KEY) return
  const emails = Object.values(await fetchUserEmails([userId], env.CLERK_SECRET_KEY))
  const staffEmails = parseStaffEmails(env.STAFF_EMAILS)
  const matched = emails.find((e) => staffEmails.has(e.toLowerCase()))
  if (matched) await db.upsertGlobalOwner(userId, matched)
  else await db.removeGlobalOwner(userId)
}

const authHandler = withMcpAuth(
  handler,
  async (_req, token) => {
    if (!token) return undefined
    // Path 1 — teio Bearer token (Claude Code plugin / terminal / service token).
    if (token.startsWith('tctx_')) {
      try {
        const resolved = await resolvePrincipal(`Bearer ${token}`, authzDeps)
        return { token, clientId: 'teio-token', scopes: [], extra: { resolved } }
      } catch {
        return undefined
      }
    }
    // Path 2 — Clerk OAuth (claude.ai / desktop Connector "individual sign-in").
    const clerkAuth = await auth({ acceptsToken: 'oauth_token' })
    const info = await verifyClerkToken(clerkAuth, token)
    if (!info || !clerkAuth.userId) return undefined
    await reconcileOwnerFromEmail(clerkAuth.userId).catch(() => {})
    const resolved: ResolvedAuth = { principal: { type: 'user', id: clerkAuth.userId } }
    return { ...info, extra: { ...(info.extra ?? {}), resolved } }
  },
  { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource/api/mcp' },
)

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
