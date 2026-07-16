# teio-context client kit

Drop-in `/teio:start` and `/teio:complete` commands for Claude Code, so a developer's
day on any project is:

- **`/teio:start`** — loads the project's shared context into the session. On the
  **first** run (empty context) it **bootstraps** from the repo/folder you're in.
  When you open a **different code repo of the same project**, it **imports that
  repo** into its own subtree (`context/repos/<repo>/`) and registers it in the
  shared layer. Otherwise it just **restores** the existing context.
- **`/teio:complete`** — persists what the session learned: updates the affected
  docs (repo-specific under `context/repos/<repo>/`, project-wide in the shared
  layer) and logs a dated handoff.

These run **inside your Claude Code session**, so they work no matter where your
code lives (GitHub, Azure Repos, a plain folder) — Claude reads your local
working copy; teio-context stores the result in the project's context repo.

## Your code repo is never touched

Guaranteed, by design:
- The commands **only READ** your working directory (Glob/Grep/Read) and are
  scoped so they **cannot** create, edit, delete, or `git`-commit anything in it.
- **Every write goes to the separate teio-context context repo** (teio's own git
  repo), via the teio-context MCP tools — never to your code repo.
- The **plugin** installs at user level (into Claude Code's plugin cache), so
  **nothing is added to your code repo** — no `.claude/` or `.mcp.json` committed.

## Install (one step)

Install the **plugin** — it ships both commands and connects to the **hosted**
teio-context MCP over HTTPS, so it works in the **terminal and the desktop app**
(nothing runs locally). From your **terminal**:
```
claude plugin marketplace add teio-AI/teio-context
claude plugin install teio@teio-ai --config api_token=tctx_YOUR_TOKEN
```
`tctx_…` is your **personal token** (generate it under **Settings → Personal
access token**).

**Then fully quit and reopen Claude Code** — the plugin's MCP server and commands
only load on a fresh start. Commands are then `/teio:start` and `/teio:complete`.

*In-app alternative* (if your Claude Code has the `/plugin` command): `/plugin
marketplace add teio-AI/teio-context`, `/plugin install teio@teio-ai`, then
`/plugin configure teio@teio-ai` to enter the token via a prompt.

*Change the token later:* `claude plugin uninstall teio@teio-ai` then reinstall
with the new `--config api_token=…`.

## Authentication

Machine auth — no login flow. The MCP server sends your `TEIO_CONTEXT_TOKEN` as a
`Bearer` header on every API call; teio-context verifies it server-side (sha256,
constant-time) and enforces access. Token kinds:
- **Personal token** (recommended for your own agent/MCP) — generated under
  **Settings**; **space-unbound**, so it works across **all your projects** and
  acts with **your role** on each (Owner/Admin/Editor/Reader). One token, no
  swapping. `list_spaces` returns every project you can access; pick one with
  `/teio:start <slug>`.
- **Project token** — minted in a project's Tokens tab; scoped to that one
  project. **Service token** = admin-minted, explicit role, for a non-human
  consumer; can carry "require review".
- The token lives in your **user-level** MCP config, not in any repo. Treat it
  like an API key; revoke it anytime (Settings). Humans use Clerk sign-in for the
  web/API; machines/agents use these tokens.

## What writes do

By **default, writes auto-merge** to `main` (with full git history + audit;
conflicts still auto-open a PR). Flip a token's **"require review"** toggle to make
its writes open a PR instead — good for an AI agent you want a human to approve.

| Token | Can write? | With "require review" |
|-------|-----------|-----------------------|
| **personal token** (acts as you) / **service editor** | ✅ auto-merges | opens a PR |
| **reader** | ❌ read-only | — |

## Working on several projects

With a **personal token** you configure the MCP server **once** and it sees all
your projects. `/teio:start` calls `list_spaces`; if you can see more than one,
just name the project: `/teio:start acme`. No per-project token, no swapping.
(A single **project token** is still fine if you only work on one project.)

## What gets written where

One project (client) = one context repo. A **shared** layer describes the whole
system; each code repo gets its **own subtree** under `context/repos/<repo>/`.

```
context/
  overview.md            ← shared: what the whole project/client is
  architecture.md        ← shared: how the repos fit together + a Repositories index
  glossary.md            ← shared: domain terms
  conventions.md         ← shared: standing decisions (created as needed)
  handoffs/
    log.md               ← thin newest-first index (one line per session)
    2026-07-15.md        ← full handoff entries, one file per day
  repos/
    acme-api/
      overview.md        ← this repo: what it is + its role in the project
      components.md      ← this repo: main modules/dirs
      imported/…         ← this repo's existing docs, copied verbatim
    acme-web/
      overview.md
      components.md
      imported/…
```

A single-repo project just has one folder under `repos/`. Multiple code repos for
the same client all live in **one** context repo, side by side. (Future non-code
sources — meetings, people — slot in as sibling folders like `context/meetings/`.)
