# teio-context client kit

Drop-in `/startwork` and `/handoff` commands for Claude Code, so a developer's
day on any project is:

- **`/startwork`** — loads the project's shared context into the session. On the
  **first** run (empty context) it **bootstraps** the context from the repo/folder
  you're in: copies existing docs verbatim **and** writes a synthesized
  overview/architecture/components/glossary layer.
- **`/handoff`** — persists what the session learned: updates the affected context
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
2. **MCP server → user scope** (not the repo). Run once per project token:
   ```
   claude mcp add --scope user teio-context \
     --env TEIO_CONTEXT_API_URL=https://teio-context.vercel.app \
     --env TEIO_CONTEXT_TOKEN=tctx_YOUR_PROJECT_TOKEN \
     -- bun run /ABSOLUTE/PATH/TO/teio-context/mcp/server.ts
   ```
   - `TEIO_CONTEXT_TOKEN` → a **project token** (one project per token), from a
     space owner (`POST /api/spaces/:id/tokens`).
   - The `bun run …server.ts` path is until the MCP server is published as an npx
     package (see follow-up below).
3. Restart Claude Code, `cd` into your project, run `/startwork`.

## Alternative — repo-scoped (only if your team WANTS it committed)

If a team prefers the config to live with the repo, copy the commands to
`<repo>/.claude/commands/` and `client-kit/.mcp.json` to the repo root instead.
This **does** add those files to the code repo — use the zero-footprint install
above if you don't want that.

## Which token?

The token's role + connector policy decides what writes do:

| Token | `/startwork` bootstrap | `/handoff` writes |
|-------|------------------------|-------------------|
| **editor + auto-merge connector** | lands directly on `main` | merges directly |
| **editor + propose-only connector** | opens PRs | opens PRs (reviewed) |
| **reader** | ❌ can't write (read-only) | ❌ |

For a developer's own workflow, an **editor + auto-merge** token is the smooth
choice. Use **propose-only** if you want every context change reviewed before it
lands (good for AI-agent tokens).

## Working on several projects

A token maps to one project, so add **one MCP server entry per project** you work
on (`teio-context-acme`, `teio-context-platform`, …). `/startwork` calls
`list_spaces` and uses the single space that token can see; if a session has more
than one, pass the slug: `/startwork acme`.

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
