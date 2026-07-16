---
description: Load this project's shared context from teio-context — bootstrap on the first run, and import a new code repo into an existing project when needed.
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

## Layout you are reading/writing (in the context repo)
One project (client) = one context repo. It has a **shared** layer that describes
the whole system, and a **per-repo** subtree for each code repo that belongs to
the project:
```
context/
  overview.md            ← shared: what the whole project/client is
  architecture.md        ← shared: how the repos/systems fit together + a Repositories index
  glossary.md            ← shared: domain terms
  conventions.md         ← shared: standing decisions (created as needed)
  handoffs/              ← shared: dated handoff files + a log.md index
  repos/
    <repo>/overview.md   ← this code repo: what it is + its role in the project
    <repo>/components.md  ← this code repo: main modules/dirs
    <repo>/imported/…    ← this code repo's existing docs, copied verbatim
```
(Non-code context — meetings, people — will live in sibling folders like
`context/meetings/` later; same shape.)

## 1. Resolve the project + the current repo
- `list_spaces`. If exactly one comes back, use it. If several and `$ARGUMENTS`
  names one (slug or id), use that; otherwise ask me which.
- `get_version` → note the current SHA (freshness marker).
- Identify **this repo's slug** `<repo>`: use the basename of the working
  directory, normalized to a lowercase hyphenated slug. If `package.json`,
  `pyproject.toml`, or `.git/config` gives a clearer canonical name, prefer it.
  State the slug you picked.

## 2. Decide the mode
- `get_document("context/overview.md")`:
  - **Not found** → the space is empty → **BOOTSTRAP (step 3)**.
  - **Found** → context exists. Now `get_document("context/repos/<repo>/overview.md")`:
    - **Not found** → this code repo isn't in the project yet → **ADD REPO (step 4)**.
    - **Found** → **RESTORE (step 5)**.

## 3. BOOTSTRAP — first repo in a brand-new project
Read this working directory (a git repo or plain folder). Gather: READMEs,
`docs/**/*.md`, top-level `*.md`, build manifests (package.json, pyproject.toml,
go.mod, *.csproj, Cargo.toml…), the directory layout, and skim the main entry
points / largest modules. Do NOT read secrets or `.env*`.

Write (one `propose_update` per file; these are new, no baseVersion needed):
- **Shared layer:**
  - `context/overview.md` — what this project/client is, who it's for, key facts.
  - `context/architecture.md` — how it fits together, data flow, external deps.
    Include a `## Repositories` section listing this repo with a one-line role.
  - `context/glossary.md` — domain terms you inferred.
- **This repo's subtree:**
  - `context/repos/<repo>/overview.md` — what this repo is + its role.
  - `context/repos/<repo>/components.md` — its main modules/dirs.
  - `context/repos/<repo>/imported/<original-path>` — each existing prose doc,
    copied verbatim (e.g. `README.md` → `context/repos/<repo>/imported/README.md`).

Summarize source; never paste raw code dumps. Then tell me what you imported.

## 4. ADD REPO — a new code repo joining an existing project
The shared context already exists; this repo just isn't represented yet.
- Read this working directory as in step 3 (READMEs, manifests, layout, entry points).
- Write this repo's subtree: `context/repos/<repo>/overview.md`,
  `context/repos/<repo>/components.md`, and `context/repos/<repo>/imported/…`.
- **Register it in the shared layer:** `get_document("context/architecture.md")`,
  add `<repo>` to the `## Repositories` section (and note how it relates to the
  existing repos if you can tell), and `propose_update` with the `baseVersion`/
  `baseBlob` you just read. Do the same for `context/overview.md` if the project's
  one-liner should now mention this repo.
- Load the shared layer (overview/architecture) so your briefing has the whole picture.

## 5. RESTORE — load existing context
- `get_document` for `context/overview.md`, `context/architecture.md`, and this
  repo's `context/repos/<repo>/overview.md` + `context/repos/<repo>/components.md`.
- `get_document("context/handoffs/log.md")` — the newest-first index. Read the top
  lines, then `get_document` the most recent dated file it points to
  (`context/handoffs/<YYYY-MM-DD>.md`) to see what the last session did.
- If `$ARGUMENTS` hints at a task, also `search` the space and read the top hits.

## 6. Brief me
In 3–6 lines: what the project is, **which repos it spans** (from the Repositories
index), what THIS repo is and its role, what the last handoff said, and anything
stale or missing. Then we start working. When done, I'll run `/teio:complete`.
