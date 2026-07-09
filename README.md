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
registry, members/roles, connectors, machine tokens, sync cursors, audit log,
and a *derived* FTS index (tsvector + snippet, never the full body). A **GitHub
App** is the bot identity and a ruleset bypass actor on `main`. Writes take a
`base_version`: a clean, uncontended edit lands in one Contents-API call (CAS
fast path); contention falls back to a server-side 3-way merge; a true conflict
opens a PR. Webhooks keep the index fresh; a backfill cron heals dropped ones.

## Stack

Next.js App Router · Neon (`@neondatabase/serverless`, pooled) · Clerk (humans)
+ per-space machine tokens (systems) · GitHub App (git ops) · 1Password for
secrets (nothing sensitive is stored here). Deploys to Vercel.

## Status — v1 complete

| Phase | Scope | State |
|-------|-------|-------|
| 0 | De-risking spike (GitHub-API-as-merge-engine) | ✅ |
| 1 | Foundations: schema, GitHub App, Clerk, provisioning, ContextService | ✅ |
| 2 | Share OUT: authz middleware, read/search API, MCP read tools | ✅ |
| 3 | Update IN: CAS fast path → 3-way merge engine, policies, delete/move | ✅ |
| 4 | Connectors + discover: write MCP tools, TEIO client, import seeder | ✅ |
| 5 | Freshness + ops: webhooks, reindex, backfill cron, hardening | ✅ |

## Develop

```bash
bun install
cp .env.example .env.local   # fill in the values (see below)
bun run migrate              # apply db/migrations/*.sql (needs DATABASE_URL)
bun run dev                  # Next dev server
bun run typecheck            # tsc --noEmit
bun run test                 # vitest (87 tests)
bun run build                # next build
```

### Required env (see [.env.example](.env.example))

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Neon **pooled** connection string |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | The bot GitHub App |
| `GITHUB_ORG` | The **paid** org (Team/Enterprise) that owns space repos — free-tier private repos can't have rulesets (ARCHITECTURE §7.1) |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret matching the App's webhook |
| `CRON_SECRET` | Bearer the backfill cron presents (`vercel.json` runs it every 10 min) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk |
| `STAFF_USER_IDS` | Comma-separated Clerk ids allowed to create spaces |

## API surface

```
# Reads (reader+)
GET    /api/spaces                        list spaces you can see
GET    /api/spaces/:id/version            current commit SHA (staleness)
GET    /api/spaces/:id/context?path=…     { content, version, blob }
GET    /api/spaces/:id/search?q=…         FTS hits (path + snippet)
GET    /api/spaces/:id/proposals          open PRs awaiting a human
# Writes (editor+, owner for space.yaml)
POST   /api/spaces/:id/context            propose_update { path, content, base_version?, base_blob? }
DELETE /api/spaces/:id/context?path=…     delete
POST   /api/spaces/:id/context/move       { from, to, base_version? }
POST   /api/spaces/:id/sync               connector cursor ack { sha }
# Admin
POST   /api/spaces                        create + provision a space (staff)
POST   /api/spaces/:id/members            add/update a member (owner)
POST   /api/spaces/:id/connectors         register a connector (owner)
POST   /api/spaces/:id/tokens             issue a machine token (owner; shown once)
DELETE /api/spaces/:id/tokens/:tid        revoke a token (owner)
POST   /api/spaces/:id/import             seed context from files (owner, async)
# Infra
POST   /api/webhooks/github               push + pull_request sink (HMAC)
GET    /api/cron/backfill                 reconciliation cron (CRON_SECRET)
GET    /api/health
```

Writes return `200` when merged, `202` when a PR was opened (proposal/conflict).

## MCP server

A separate process consumers (Claude Code / Cursor / Codex) launch. It talks
only to the REST API above — never to GitHub or Neon directly.

```bash
TEIO_CONTEXT_API_URL=https://context.teio.ai TEIO_CONTEXT_TOKEN=tctx_acme_… bun run mcp
```

Tools: `list_spaces`, `get_version`, `get_document`, `search`, `propose_update`,
`delete_path`, `move_path`. The write-back policy (MCP connectors default to
`proposal_only`) is enforced server-side from the token's connector binding, not
by anything the adapter asserts.

## Deploy notes

- **Paid GitHub org required** for space repos (private-repo rulesets).
- Create a GitHub App with `contents:write`, `pull_requests:write`,
  `administration:write`, `metadata:read`; subscribe to `push` + `pull_request`;
  install it on the org. Add it as a **ruleset bypass actor** — provisioning
  creates the PR-required ruleset, and the bot must bypass it (verified in the
  Phase 0 spike).
- `vercel.json` schedules the backfill cron every 10 minutes.
