---
description: Load this project's shared context from teio-context — and, on the first run, bootstrap it from this repo/folder.
argument-hint: "[project-slug]  (optional if your token maps to one project)"
allowed-tools: Read, Glob, Grep, mcp__teio-context__list_spaces, mcp__teio-context__get_version, mcp__teio-context__get_document, mcp__teio-context__search, mcp__teio-context__propose_update
---

You are starting a work session on a project backed by **teio-context** (a shared
context layer). Do the steps below, then give me a short briefing.

**⚠️ This working directory (my code repo) is READ-ONLY to you.** Never create,
edit, move, or delete any file here, and never run git or any shell command
against it. You may only READ it (Glob/Grep/Read). Every write you make goes to
the **separate teio-context context repo** via the teio-context MCP tools —
never to my code repo.

## 1. Resolve the project
- Call `list_spaces`. If exactly one space comes back, use it. If several and
  `$ARGUMENTS` names one (slug or id), use that; otherwise ask me which.
- Call `get_version` and note the current SHA (freshness marker).

## 2. First run, or already bootstrapped?
- Call `get_document(space, "context/overview.md")`.
  - **Exists** → go to step 4 (RESTORE).
  - **Not found** → first session on this project → go to step 3 (BOOTSTRAP).

## 3. BOOTSTRAP (first run only) — build initial context from THIS working copy
Read my local working directory (a git repo or a plain folder — either is fine):
- Gather: every README, `docs/**/*.md`, top-level `*.md`, build manifests
  (package.json, pyproject.toml, go.mod, *.csproj, Cargo.toml…), the directory
  layout, and skim the main entry points / largest modules. Do NOT read secrets
  or `.env*`.

Then write these via `propose_update` (one call per file; no baseVersion needed —
these are new files). This is the "Both" strategy — **copied docs + a synthesized
layer**:

Synthesized layer (you write these from what you learned):
- `context/overview.md` — what this project is, who it's for, key facts.
- `context/architecture.md` — components, how they fit, data flow, external deps.
- `context/components.md` — main modules/dirs and what each does.
- `context/glossary.md` — domain terms you inferred.

Copied layer (verbatim, so nothing curated is lost):
- For each existing prose doc, copy it under `context/imported/<original-path>`
  (e.g. `docs/api.md` → `context/imported/docs/api.md`, `README.md` →
  `context/imported/README.md`).

Summarize source; never paste raw code dumps. Keep each doc focused and
skimmable. When done, tell me what you imported.

## 4. RESTORE (context already exists) — load it into this session
- `get_document` for `context/overview.md`, `context/architecture.md`, and
  `context/components.md`.
- `get_document("context/handoffs/log.md")` (may not exist) — this is the
  newest-first **index** of handoffs. Read the top lines for the timeline, then
  `get_document` the most recent dated file it points to (e.g.
  `context/handoffs/<YYYY-MM-DD>.md`) to see what the last session actually did.
- If `$ARGUMENTS` hints at a task, also `search` the space for related terms and
  read the top hits with `get_document`.

## 5. Brief me
In 3–6 lines: what this project is, what the last handoff said (if any), and
anything that looks stale or missing. Then we start working. When we're done,
I'll run `/teio-complete` to persist what we learned.
