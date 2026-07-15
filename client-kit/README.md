# teio-context client kit

Drop-in `/teio-start` and `/teio-complete` commands for Claude Code, so a developer's
day on any project is:

- **`/teio-start`** — loads the project's shared context into the session. On the
  **first** run (empty context) it **bootstraps** the context from the repo/folder
  you're in: copies existing docs verbatim **and** writes a synthesized
  overview/architecture/components/glossary layer.
- **`/teio-complete`** — persists what the session learned: updates the affected context
  docs and prepends an entry to `context/handoffs/log.md`.

These run **inside your Claude Code session**, so they work no matter where your
code lives (GitHub, Azure Repos, a plain folder) — Claude reads your local
working copy; teio-context stores the result in the project's context repo.

## Your code repo is never touched

Guaranteed, by design:
- The commands **only READ** your working directory (Glob/Grep/Read) and are
  scoped so they **cannot** create, edit, delete, or `git`-commit anything in it.
- **Every write goes to the separate teio-context context repo** (teio's own git
  repo), via the teio-context MCP tools — never to your code repo.
- The install below is **user-level**, so **no files are added to your code repo
  either** (no `.claude/`, no `.mcp.json` committed).

## Install — zero footprint (recommended)

1. **Commands → your user folder** (available in every repo, added to none):
   ```
   mkdir -p ~/.claude/commands
   cp client-kit/.claude/commands/*.md ~/.claude/commands/
   ```
2. **MCP server → user scope** (not the repo). Configure it **once** with a
   **personal token** that works across all your projects:
   ```
   claude mcp add --scope user teio-context \
     --env TEIO_CONTEXT_API_URL=https://teio-context.vercel.app \
     --env TEIO_CONTEXT_TOKEN=tctx_YOUR_PERSONAL_TOKEN \
     -- npx -y teio-context-mcp
   ```
   - `TEIO_CONTEXT_TOKEN` → your **personal access token**: generate it on the
     **dashboard** ("Personal access token"). One token for every project; it acts
     with your role on each. No per-project swapping.
   - `npx teio-context-mcp` works once the package is published to npm (see
     `packages/teio-context-mcp`). Until then, build it and point at the local
     bundle: `-- node /ABS/PATH/packages/teio-context-mcp/dist/server.js`.
3. Restart Claude Code, `cd` into a project, run `/teio-start <project-slug>`.

## Alternative — repo-scoped (only if your team WANTS it committed)

If a team prefers the config to live with the repo, copy the commands to
`<repo>/.claude/commands/` and `client-kit/.mcp.json` to the repo root instead.
This **does** add those files to the code repo — use the zero-footprint install
above if you don't want that.

## Authentication

Machine auth — no login flow. The MCP server sends your `TEIO_CONTEXT_TOKEN` as a
`Bearer` header on every API call; teio-context verifies it server-side (sha256,
constant-time) and enforces access. Token kinds:
- **Personal token** (recommended for your own agent/MCP) — generated on the
  **dashboard**; **space-unbound**, so it works across **all your projects** and
  acts with **your role** on each (Owner/Admin/Editor/Reader). One token, no
  swapping. `list_spaces` returns every project you can access; pick one with
  `/teio-start <slug>`.
- **Project token** — minted in a project's Tokens tab; scoped to that one
  project. **Service token** = admin-minted, explicit role, for a non-human
  consumer; can carry "require review".
- The token lives in your **user-level** MCP config, not in any repo. Treat it
  like an API key; revoke it anytime (dashboard). Humans use Clerk sign-in for the
  web/API; machines/agents use these tokens.

## What writes do

By **default, writes auto-merge** to `main` (with full git history + audit;
conflicts still auto-open a PR). Flip a token's **"require review"** toggle to make
its writes open a PR instead — good for an AI agent you want a human to approve.

| Token | Can write? | With "require review" |
|-------|-----------|-----------------------|
| **editor / admin** (or a member token that inherits one) | ✅ auto-merges | opens a PR |
| **reader** | ❌ read-only | — |

## Working on several projects

With a **personal token** you configure the MCP server **once** and it sees all
your projects. `/teio-start` calls `list_spaces`; if you can see more than one,
just name the project: `/teio-start acme`. No per-project token, no swapping.
(A single **project token** is still fine if you only work on one project.)

## What gets written where

```
context/
  overview.md            ← synthesized (what/who/key facts)
  architecture.md        ← synthesized (components, data flow, deps)
  components.md          ← synthesized (modules/dirs)
  glossary.md            ← synthesized (domain terms)
  imported/…             ← your existing docs, copied verbatim
  handoffs/log.md        ← one line of history per /handoff (newest first)
```
