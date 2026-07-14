/**
 * LIVE demo for teio-context — runs against the real deployment (public HTTPS
 * API) + the real GitHub org + real Neon. Tells an end-to-end story:
 *   • two client projects, each backed by its own git repo
 *   • people invited with roles; services/agents granted scoped tokens
 *   • many consumers (different "LLMs") reading the same context concurrently
 *   • two-way sync: trusted systems auto-merge; AI agents propose → PR
 *   • concurrency safety: overlapping edits never clobber — they become a PR
 *   • full-text search over the context
 *
 * Setup (provision repos + tokens) uses the internal service — that's the
 * admin/staff step. Everything the AUDIENCE watches goes over the live public
 * API exactly as a real consumer/agent would.
 *
 * Run:   GITHUB_APP_PRIVATE_KEY="$(cat <pem>)" bun scripts/demo.ts
 * Clean: GITHUB_APP_PRIVATE_KEY="$(cat <pem>)" bun scripts/demo.ts cleanup <slug> <slug> …
 */
import { getGitHubConfig } from '@/lib/env'
import { getInstallationId, InstallationTokenProvider } from '@/lib/github/app-auth'
import { GitHubClient } from '@/lib/github/client'
import { provisionSpaceRepo } from '@/lib/github/provision'
import { renderSpaceYaml } from '@/lib/space-yaml'
import { getContextService } from '@/lib/wiring'
import * as db from '@/db'
import { sql } from '@/db/client'
import { generateToken } from '@/lib/auth/tokens'

const BASE = process.env.DEMO_BASE ?? 'https://teio-context.vercel.app'
const cfg = getGitHubConfig()

// ---- pretty output -----------------------------------------------------------
const line = () => console.log('─'.repeat(72))
const h = (t: string) => {
  console.log('\n')
  line()
  console.log(`  ${t}`)
  line()
}
const say = (t: string) => console.log(`  ${t}`)
const sub = (t: string) => console.log(`    ${t}`)

// ---- live HTTPS API client (what a real consumer/agent uses) -----------------
async function api(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// GitHub's Contents API is read-after-write eventually-consistent (a fresh
// commit can 404 or read stale for a second or two). For a live demo we retry
// until the read is present — and, when we need a write base, until it reflects
// the exact commit we just made, so the conflict demo is deterministic.
async function readDoc(token: string, path: string, wantVersion?: string): Promise<{ status: number; json: any }> {
  let last = { status: 0, json: null as any }
  for (let i = 0; i < 8; i++) {
    last = await api(token, 'GET', path)
    if (last.status === 200 && (!wantVersion || last.json?.version === wantVersion)) return last
    await sleep(700)
  }
  return last
}

async function installClient(): Promise<GitHubClient> {
  const installationId = await getInstallationId(cfg.appId, cfg.privateKey, cfg.org, cfg.ownerType)
  const token = await new InstallationTokenProvider(cfg.appId, cfg.privateKey).getToken(installationId)
  return new GitHubClient(token)
}

// ---- provision one project (repo + registry + members + tokens) --------------
interface Project {
  id: string
  slug: string
  name: string
  repoUrl: string
  tokens: { platform: string; agent: string; reader: string }
}

async function provisionProject(gh: GitHubClient, slug: string, name: string, owner: string): Promise<Project> {
  const repo = `teio-context-${slug}`
  const prov = await provisionSpaceRepo(gh, {
    owner: cfg.org,
    ownerType: cfg.ownerType,
    repo,
    appId: cfg.appId,
    spaceYaml: renderSpaceYaml({ name, slug, owner }),
    private: cfg.visibility === 'private',
  })
  const installationId = await getInstallationId(cfg.appId, cfg.privateKey, cfg.org, cfg.ownerType)
  const space = await db.createSpace({
    slug,
    name,
    owner: cfg.org,
    repo,
    installationId,
    currentSha: prov.mainSha,
    createdBy: owner,
  })

  // The creator is an owner; invite a teammate as an editor (their Clerk id).
  await db.addMember(space.id, 'user', owner, 'owner', owner)
  await db.addMember(space.id, 'user', 'user_teammate_demo', 'editor', owner)

  // Scoped machine identities: the TEIO platform (auto-merge), an AI agent
  // (propose-only → PR), and a read-only viewer.
  const teioConn = await db.createConnector({ spaceId: space.id, kind: 'teio', name: 'teio-platform', writeBackPolicy: 'auto_merge_clean' })
  const mcpConn = await db.createConnector({ spaceId: space.id, kind: 'mcp', name: 'ai-agent', writeBackPolicy: 'proposal_only' })

  const mkToken = async (nm: string, role: 'reader' | 'editor', connectorId?: string) => {
    const t = generateToken(slug)
    await db.insertApiToken({ spaceId: space.id, name: nm, tokenPrefix: t.prefix, tokenHash: t.hash, role, connectorId, createdBy: owner })
    return t.token
  }

  return {
    id: space.id,
    slug,
    name,
    repoUrl: `https://github.com/${cfg.org}/${repo}`,
    tokens: {
      platform: await mkToken('teio-platform', 'editor', teioConn.id),
      agent: await mkToken('ai-agent', 'editor', mcpConn.id),
      reader: await mkToken('readonly-viewer', 'reader'),
    },
  }
}

async function cleanup(slugs: string[]): Promise<void> {
  const gh = await installClient()
  for (const slug of slugs) {
    const space = await db.getSpaceBySlug(slug)
    const repo = `teio-context-${slug}`
    await gh.request('DELETE', `/repos/${cfg.org}/${repo}`).catch(() => {})
    if (space) await sql`delete from spaces where id = ${space.id}`
    console.log(`🧹 removed ${slug} (repo + Neon)`)
  }
}

// ---- the demo ---------------------------------------------------------------
async function main(): Promise<void> {
  const owner = process.env.DEMO_OWNER ?? 'user_3GUQLXQIZawOEvi3s2T5mTYrAdo'
  const rid = Date.now().toString(36)
  const gh = await installClient()

  h('teio-context — LIVE END-TO-END DEMO')
  say(`Deployment: ${BASE}`)
  say(`GitHub org: ${cfg.org}   •   Store: one private-ish git repo per project`)

  // 1) PROVISION TWO PROJECTS ---------------------------------------------------
  h('1) Two client projects, each backed by its own git repo')
  const acme = await provisionProject(gh, `acme-${rid}`, 'Acme Corp', owner)
  const plat = await provisionProject(gh, `platform-${rid}`, 'Internal Platform', owner)
  for (const p of [acme, plat]) {
    say(`✓ ${p.name}  →  ${p.repoUrl}`)
    sub(`members: ${owner} (owner), user_teammate_demo (editor)`)
    sub(`tokens:  teio-platform [auto-merge] · ai-agent [propose-only] · readonly-viewer [read]`)
  }
  say('“Inviting” = add a person by role (members) or issue a scoped token (services/agents).')

  // 2) SEED CONTEXT (over the live API, as the TEIO platform) --------------------
  h('2) Seed context — real HTTPS writes as the TEIO platform')
  const seed = async (p: Project, path: string, content: string) => {
    const r = await api(p.tokens.platform, 'POST', `/api/spaces/${p.id}/context`, { path, content })
    sub(`${p.name}: POST ${path} → ${r.status} ${r.json?.status} @ ${String(r.json?.version).slice(0, 8)}`)
  }
  await seed(acme, 'context/overview.md', '# Acme Corp\n\nB2B logistics client. Primary contact: Dana Ruiz.\n')
  await seed(acme, 'context/billing.md', '# Billing\n\nAcme is invoiced monthly, net-30, via ACH.\n')
  await seed(plat, 'context/overview.md', '# Internal Platform\n\nShared services: auth, billing, notifications.\n')
  await seed(plat, 'context/runbook.md', '# Runbook\n\nOn-call rotates weekly. Escalate paging incidents to #platform.\n')

  // 3) CONCURRENT READS BY DIFFERENT AGENTS / LLMs ------------------------------
  h('3) Many consumers read the SAME context concurrently (different LLMs)')
  say('Three independent agents, three tokens, one shared source of truth — in parallel:')
  const reads = await Promise.all([
    readDoc(acme.tokens.agent, `/api/spaces/${acme.id}/context?path=context/billing.md`).then((r) => ['Claude agent  → Acme/billing', r] as const),
    readDoc(plat.tokens.reader, `/api/spaces/${plat.id}/context?path=context/runbook.md`).then((r) => ['GPT agent     → Platform/runbook', r] as const),
    readDoc(acme.tokens.reader, `/api/spaces/${acme.id}/context?path=context/overview.md`).then((r) => ['Dashboard     → Acme/overview', r] as const),
  ])
  for (const [who, r] of reads) sub(`${who}: ${r.status} — “${String(r.json?.content).replace(/\n/g, ' ').slice(0, 52)}…”`)

  // 4) ROLES / GOVERNANCE -------------------------------------------------------
  h('4) Roles are enforced by the API')
  const denied = await api(acme.tokens.reader, 'POST', `/api/spaces/${acme.id}/context`, { path: 'context/overview.md', content: 'hacked' })
  sub(`read-only token tries to write → ${denied.status} ${denied.json?.error}  ✋ blocked`)
  const allowed = await api(acme.tokens.platform, 'POST', `/api/spaces/${acme.id}/context`, { path: 'context/overview.md', content: '# Acme Corp\n\nB2B logistics client. Primary contact: Dana Ruiz (VP Ops).\n' })
  sub(`editor token writes    → ${allowed.status} ${allowed.json?.status}  ✓ allowed`)

  // 5) TWO-WAY SYNC WITH POLICY -------------------------------------------------
  h('5) Two-way sync: trusted systems auto-merge, AI agents propose → PR')
  const merged = await api(plat.tokens.platform, 'POST', `/api/spaces/${plat.id}/context`, { path: 'context/runbook.md', content: '# Runbook\n\nOn-call rotates weekly. Escalate paging incidents to #platform-oncall.\n' })
  sub(`TEIO platform edit  → ${merged.status} ${merged.json?.status} (committed straight to main)`)
  const proposed = await api(plat.tokens.agent, 'POST', `/api/spaces/${plat.id}/context`, { path: 'context/runbook.md', content: '# Runbook\n\nOn-call rotates weekly. Escalate paging incidents to #platform-oncall.\nAI note: add a secondary on-call.\n' })
  sub(`AI agent edit       → ${proposed.status} ${proposed.json?.status}  📝 opened a PR (main untouched):`)
  sub(`   ${proposed.json?.prUrl}`)

  // 6) CONCURRENCY SAFETY -------------------------------------------------------
  h('6) Concurrent edits to the same line never clobber')
  const created = await api(acme.tokens.platform, 'POST', `/api/spaces/${acme.id}/context`, { path: 'context/status.md', content: '# Status\n\nSHARED LINE\n' })
  // Base both writers on the EXACT commit we just made (wait for GitHub to
  // reflect it), so A merges cleanly and B is provably working from a stale base.
  const base = (await readDoc(acme.tokens.platform, `/api/spaces/${acme.id}/context?path=context/status.md`, created.json?.version)).json
  const a = await api(acme.tokens.platform, 'POST', `/api/spaces/${acme.id}/context`, { path: 'context/status.md', content: '# Status\n\nCHANGED BY WRITER A\n', base_version: base.version, base_blob: base.blob })
  const b = await api(acme.tokens.platform, 'POST', `/api/spaces/${acme.id}/context`, { path: 'context/status.md', content: '# Status\n\nCHANGED BY WRITER B\n', base_version: base.version, base_blob: base.blob })
  sub(`writer A (fresh base)  → ${a.status} ${a.json?.status}  ✓ merged`)
  sub(`writer B (stale base)  → ${b.status} ${b.json?.status}  ⚠ conflict → PR (no data lost):`)
  sub(`   ${b.json?.prUrl}`)

  // 7) SEARCH -------------------------------------------------------------------
  h('7) Full-text search over a project’s context')
  const hits = await api(acme.tokens.reader, 'GET', `/api/spaces/${acme.id}/search?q=invoiced`)
  const results = hits.json?.results ?? []
  say(`query “invoiced” → ${results.length} hit(s):`)
  for (const hitObj of results) sub(`${hitObj.path}: “${hitObj.highlight}”`)

  // WRAP UP ---------------------------------------------------------------------
  h('Open these live during the demo')
  say(`Acme repo:      ${acme.repoUrl}`)
  say(`Platform repo:  ${plat.repoUrl}`)
  say(`Agent PR:       ${proposed.json?.prUrl}`)
  say(`Conflict PR:    ${b.json?.prUrl}`)
  console.log('')
  say(`Clean up when done:`)
  say(`  GITHUB_APP_PRIVATE_KEY="$(cat <pem>)" bun scripts/demo.ts cleanup ${acme.slug} ${plat.slug}`)
  console.log('')
}

const [, , cmd, ...rest] = process.argv
if (cmd === 'cleanup') {
  await cleanup(rest)
} else {
  await main()
}
