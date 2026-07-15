# teio-context — live demo runbook

A 10-minute, fully-live demo of teio-context for Tarush + team. Everything runs
against the **real deployment** (`https://teio-context.vercel.app`), the real
GitHub org (`teio-context-dev`), and real Neon. No slides, no mocks.

## The story in one line
> Canonical context about each client (and our internal platform) lives as plain
> markdown in **one git repo per project**. teio-context serves it **two ways**
> — out to consumers, back in from them — over one connector surface (git + REST
> + MCP), with roles, governance (AI edits become PRs), and conflict-safe writes.

---

## Before the room (2 min, do this once)

1. **Have the App private key path handy** (same one used all session):
   `/Users/ravi/.config/teio-context/teio-context-spike.2026-07-14.private-key.pem`

2. **Run the demo** — it provisions two fresh projects and drives the live API:
   ```bash
   cd ~/projects/teio-context
   GITHUB_APP_PRIVATE_KEY="$(cat /Users/ravi/.config/teio-context/teio-context-spike.2026-07-14.private-key.pem)" \
     bun scripts/demo.ts
   ```
   It prints a narrated walk-through and, at the end, four URLs (two repos, an
   agent PR, a conflict PR). Keep that terminal output up — it's your script.

3. **Open these tabs** (from the printed URLs):
   - the **Acme Corp** repo (shows `context/*.md` — "context is just git")
   - the **agent PR** (an AI edit awaiting human review)
   - the **conflict PR** (a concurrent edit that was safely parked)
   - `https://teio-context.vercel.app/` (the deployed control plane; sign in to
     show the staff/landing page)

> Re-running makes brand-new projects each time (timestamped), so you can rehearse
> freely. Clean up any run with the `cleanup` line the script prints.

---

## Talk track (what to say as each section prints)

**1) Two projects, each its own git repo.**
"Every client is a *space* — its own private git repo. Here are two: a client,
Acme Corp, and our Internal Platform. The registry, permissions, and search index
live in Postgres; the actual context lives in git."

**2) Seed context — real HTTPS writes.**
"I'm writing context through the public API, exactly as our platform would —
overview, billing, a runbook. Each returns `200 merged` with a commit SHA. That's
a real git commit."

**3) Concurrent reads by different LLMs.**
"Now three independent agents read the *same* context at the same time — a Claude
agent, another LLM, and a dashboard — each with its own token. One canonical
source, any number of concurrent consumers, any model." *(This is the multi-LLM
answer: each token = a different agent/app; MCP bonus below connects a real one.)*

**4) Roles are enforced.**
"A read-only token tries to write — `403`, blocked. An editor token writes —
`200`. Access is per-project and role-based."

**5) Two-way sync with policy — the core idea.**
"By default writes auto-merge straight to main. But a token can opt into
**review** — then its edits open a **pull request** for a human instead of
merging. The AI-agent token here has review on, so its edit is a PR. Same API,
per-token governance. Open the PR tab — that's the AI's proposed change."

**6) Concurrent edits never clobber.**
"Two writers edit the same line from the same starting point. First wins and
merges. The second — working from a now-stale base — is *not* lost and does *not*
overwrite: it becomes a **conflict PR**. Open that tab. No lost updates, ever."

**7) Search.**
"Full-text search across the project's context, with the matched term
highlighted — populated automatically on every write."

**Close.** "That's the whole loop, live: multi-project, invited people + scoped
agents, concurrent multi-LLM reads, governed two-way writes, conflict-safe, and
searchable — served over git, REST, and MCP."

---

## How people & agents are "invited" (expect this question)
- **People**: invited by **email** with a **role** — `admin` / `editor` / `reader`.
  They accept by signing up / logging in; membership is materialized from their
  verified email. (Owner is the global role that creates projects.)
- **Services / AI agents**: issued a **scoped token** — a member's own token
  inherits their role, or an admin mints a service token with an explicit role.
  An optional **"require review"** flag makes its writes open a PR. Revocable,
  per-project, never mirrored anywhere.

## Bonus: connect a *real* LLM over MCP (optional, strong finish)
teio-context ships an MCP server, so a real Claude (Desktop/Code) can read/write
context as tools. Point it at the live API with a token the demo printed:

```jsonc
// claude_desktop_config.json (or Claude Code MCP config). Verified env names.
{
  "mcpServers": {
    "teio-context": {
      "command": "bun",
      "args": ["run", "/Users/ravi/projects/teio-context/mcp/server.ts"],
      "env": {
        "TEIO_CONTEXT_API_URL": "https://teio-context.vercel.app",
        "TEIO_CONTEXT_TOKEN": "<paste the ai-agent token the demo printed>"
      }
    }
  }
}
```
The token is bound to one project, so the agent calls **`list_spaces`** first to
get the space id, then passes it to the other tools — no space id in config. Then
ask Claude: *"list my context spaces, then search that space for billing terms"*
or *"propose an update to context/overview.md"* — watch it call the tools live,
and (because the ai-agent token is propose-only) **open a PR** instead of writing
to main. Tools available: `list_spaces`, `get_version`, `get_document`, `search`,
`propose_update`, `move_path`, `delete_path`, `list_proposals`.

## The developer's day: `/teio-start` + `/teio-complete` (client kit)
The strongest segment — show context capture as part of a real workflow, not raw
API calls. Ships in [`client-kit/`](client-kit/README.md) as Claude Code commands
that run in the developer's own session (so they work for GitHub, Azure Repos, or
a plain folder — Claude reads the local working copy; teio-context stores it).

- **`/teio-start`** — loads the project's shared context into the session. On the
  **first** run (empty context) it **bootstraps**: copies existing docs verbatim
  **and** synthesizes `overview / architecture / components / glossary`. This is
  the "they forgot to document it" safety net — the context repo is never empty.
- **`/teio-complete`** — persists the session: updates the affected context docs **and**
  prepends an entry to `context/handoffs/log.md`. The next `/teio-start` picks it up.

Demo beat: open a fresh repo, run `/teio-start` (watch it import), make a change,
run `/teio-complete` (watch it write back + log), then run `/teio-start` again in a
"second developer" window and show the handoff is already there. Setup is in
`client-kit/README.md` (copy the commands, fill `.mcp.json` with a project token).

> These run in the dev's Claude, so they can't be scripted headlessly like §1–7 —
> rehearse once beforehand. The underlying reads/writes (incl. nested paths like
> `context/handoffs/log.md`) are verified live.

## FAQ ammo
- **"Where's the data?"** In git — one repo per project. Postgres holds only the
  registry, roles, tokens, audit log, and a rebuildable search index (snippets,
  never full bodies). A control-plane leak can't expose full client context.
- **"What if two systems write at once?"** Section 6 — conflict-safe, PR-backed,
  no lost updates.
- **"Can we audit changes?"** Every read/write/merge/conflict is in the audit log
  with the real actor (and who merged a PR).
- **"Is this tied to TEIO?"** No — standalone deployment, its own auth and infra.

## Cleanup
The script prints the exact line, e.g.:
```bash
GITHUB_APP_PRIVATE_KEY="$(cat <pem>)" bun scripts/demo.ts cleanup acme-<id> platform-<id>
```
