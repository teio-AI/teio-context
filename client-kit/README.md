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

## Install (per code repo, or globally)

1. **Copy the commands** into the repo you work in (or `~/.claude/` for all repos):
   ```
   cp -r client-kit/.claude/commands/* <your-repo>/.claude/commands/
   ```
2. **Add the MCP server.** Copy `client-kit/.mcp.json` to your repo root (Claude
   Code reads project MCP config from `.mcp.json`) and fill in:
   - `args` → the absolute path to this teio-context checkout's `mcp/server.ts`
     (until the MCP server is published as an npx package).
   - `TEIO_CONTEXT_API_URL` → your deployment (e.g. `https://teio-context.vercel.app`).
   - `TEIO_CONTEXT_TOKEN` → a **project token** (one project per token). Get it
     from a space owner (`POST /api/spaces/:id/tokens`).
3. Restart Claude Code so it picks up the MCP server, then run `/startwork`.

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
