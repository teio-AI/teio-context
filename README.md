# teio-context

A lightweight, standalone shared-context layer. It holds the canonical context
about our clients and our internal platform as **plain markdown in a private
git repo per space**, and serves it two ways — out to consumers and back in
from them — over one connector surface: **git + a REST API + an MCP server**.

The feature that makes it worth building is the **two-way link**: context isn't
just exported, it's updated back in, so the canonical copy never goes stale.

- Product spec: [SPEC.md](SPEC.md)
- Locked architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Phase 0 de-risking spike: [SPIKE-FINDINGS.md](SPIKE-FINDINGS.md)

## How it works (one paragraph)

Each **space** is one private GitHub repo of markdown (isolation = the repo
boundary). **Git owns content, versioning, and 3-way merge** — run through
GitHub's Git Data + Merges APIs, so the whole service stays serverless with no
local working copy. A thin **Neon (Postgres) control plane** holds only the
registry, members/roles, global owners, machine + personal tokens, audit log,
and a *derived* FTS index (tsvector + snippet, never the full body). A **GitHub
App** is the bot identity and a ruleset bypass actor on `main`. Writes take a
`base_version`: a clean, uncontended edit lands in one Contents-API call (CAS
fast path); contention falls back to a server-side 3-way merge; a true conflict
opens a PR. Webhooks keep the index fresh; a backfill cron heals dropped ones.

## Stack

Next.js App Router · Neon (`@neondatabase/serverless`, pooled) · Clerk (humans +
OAuth for the MCP connector) · personal + service Bearer tokens (systems) · GitHub
App (git ops). Secrets live in env (`.env.local` / Vercel). Deploys to Vercel.

## Status — v1 complete

| Phase | Scope | State |
|-------|-------|-------|
| 0 | De-risking spike (GitHub-API-as-merge-engine) | ✅ |
| 1 | Foundations: schema, GitHub App, Clerk, provisioning, ContextService | ✅ |
| 2 | Share OUT: authz middleware, read/search API, MCP read tools | ✅ |
| 3 | Update IN: CAS fast path → 3-way merge engine, policies, delete/move | ✅ |
| 4 | Share IN: write MCP tools, import seeder | ✅ |
| 5 | Freshness + ops: webhooks, reindex, backfill cron, hardening | ✅ |

## Develop

```bash
bun install
cp .env.example .env.local   # fill in the values (see below)
bun run migrate              # apply db/migrations/*.sql (needs DATABASE_URL)
bun run dev                  # Next dev server
bun run typecheck            # tsc --noEmit
bun run test                 # vitest (174 tests)
bun run build                # next build
```

### Required env (see [.env.example](.env.example))

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Neon **pooled** connection string |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | The bot GitHub App |
| `GITHUB_ORG` | The account that owns space repos (org login, or username when `GITHUB_OWNER_TYPE=user`) |
| `GITHUB_OWNER_TYPE` | `org` (default) or `user` — where space repos are created |
| `GITHUB_REPO_VISIBILITY` | `private` (default) or `public` (⚠ world-readable context) |
| `GITHUB_ALLOW_UNPROTECTED` | `true` to create private repos **without** branch protection on GitHub Free (rulesets 403). Off by default → provisioning fails loud rather than silently unprotected (ARCHITECTURE §7.1) |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret matching the App's webhook |
| `CRON_SECRET` | Bearer the backfill cron presents (`vercel.json` runs it every 10 min) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk (also the OAuth authorization server for the MCP connector) |
| `STAFF_USER_IDS` | Comma-separated Clerk ids that are **global owners** (create + see + administer every space) |
| `STAFF_EMAILS` | Comma-separated emails granted global owner — pre-authorize before signup; materialized into `global_owners` on login |

## API surface

```
# Reads (reader+)
GET    /api/spaces                        list spaces you can see
GET    /api/spaces/:id/version            current commit SHA (staleness)
GET    /api/spaces/:id/context?path=…     { content, version, blob }
GET    /api/spaces/:id/search?q=…         FTS hits (path + snippet)
GET    /api/spaces/:id/proposals          open PRs awaiting a human
# Writes (editor+, admin for space config)
POST   /api/spaces/:id/context            propose_update { path, content, base_version?, base_blob? }
DELETE /api/spaces/:id/context?path=…     delete
POST   /api/spaces/:id/context/move       { from, to, base_version? }
# Admin
POST   /api/spaces                        create + provision a space (global owner)
POST   /api/spaces/:id/members            add/update a member (admin)
DELETE /api/spaces/:id/members/:mid       remove a member (admin; last admin protected)
POST   /api/spaces/:id/tokens             issue a SERVICE token (admin; shown once)
DELETE /api/spaces/:id/tokens/:tid        revoke a service token (admin)
POST   /api/spaces/:id/import             seed context from files (admin, async)
# Personal tokens (self-serve; space-unbound, act as you across all your spaces)
GET    /api/me                            who am I + owner status (reconciles STAFF_EMAILS)
POST   /api/me/tokens                     mint a personal token (shown once)
DELETE /api/me/tokens/:tid                revoke your personal token
# MCP (dual auth: Bearer tctx_… OR Clerk OAuth) + OAuth discovery
ALL    /api/mcp                           MCP endpoint (app/api/[transport])
GET    /.well-known/oauth-authorization-server        Clerk AS metadata (RFC 8414)
GET    /.well-known/oauth-protected-resource/api/mcp  resource metadata (RFC 9728)
# Infra
POST   /api/webhooks/github               push + pull_request sink (HMAC)
GET    /api/cron/backfill                 reconciliation cron (CRON_SECRET)
GET    /api/health
```

Writes return `200` when merged, `202` when a PR was opened (proposal/conflict).

## MCP

The MCP server is **hosted** at `/api/mcp` (Streamable HTTP, stateless — no local
process). One endpoint, **dual auth**:

- **Claude Code plugin / terminal** → `Authorization: Bearer tctx_…` (a personal
  token from Settings). Install: `claude plugin marketplace add teio-AI/teio-context`
  then `claude plugin install teio@teio-ai --config api_token=tctx_…`.
- **claude.ai / desktop connector** → Clerk **OAuth** "individual sign-in" (DCR);
  the `.well-known/*` routes advertise Clerk as the authorization server.

Tools: `list_spaces`, `get_version`, `get_document`, `search`, `propose_update`,
`delete_path`, `move_path`, `list_proposals`. Each call re-verifies the token and
authorizes against the caller's space role with the **same** logic as the REST
routes (`authorizeResolved`). A personal token / signed-in user acts with **their**
role on each space; a token flagged **require review** opens a PR instead of merging.

A legacy local stdio server (`mcp/server.ts`, `bun run mcp`) still exists for a
purely-local process but isn't the primary path — see [.env.example](.env.example).
See [docs/onboarding.md](docs/onboarding.md) for the end-user setup of both paths.

## Deploy notes

Three provisioning modes (ARCHITECTURE §7.1):

| Mode | Env | Protection |
|------|-----|------------|
| Paid org, private | `GITHUB_OWNER_TYPE=org`, `GITHUB_REPO_VISIBILITY=private` | ruleset + App bypass |
| Public repos (free) | `GITHUB_REPO_VISIBILITY=public` | ruleset + App bypass (rulesets are free on public repos) |
| Free-tier private | `GITHUB_ALLOW_UNPROTECTED=true` | ⚠ none (opt-in; provisioning warns) |

- Create a GitHub App with `contents:write`, `pull_requests:write`,
  `administration:write`, `metadata:read`; subscribe to `push` + `pull_request`;
  install it on the org. Add it as a **ruleset bypass actor** — provisioning
  creates the PR-required ruleset, and the bot must bypass it (verified in the
  Phase 0 spike). (Skipped when `GITHUB_ALLOW_UNPROTECTED=true`.)
- For the **MCP connector** on claude.ai / desktop, enable **Dynamic Client
  Registration** on the Clerk instance so clients can self-register for OAuth.
- `vercel.json` schedules the backfill cron every 10 minutes.
