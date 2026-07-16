---
description: Persist what this session learned back into teio-context — update the affected docs (repo-specific + shared) and log the handoff.
argument-hint: "[short summary of what changed]"
allowed-tools: Read, Glob, Grep, mcp__teio-context__list_spaces, mcp__teio-context__get_document, mcp__teio-context__search, mcp__teio-context__propose_update
---

You are ending a work session on a teio-context-backed project. Persist what
changed so the next person or agent picks it up on their `/teio-start`.

**⚠️ This working directory (my code repo) is READ-ONLY to you.** Never create,
edit, move, or delete any file here, and never run git against it. All writes go
to the **separate teio-context context repo** via the teio-context MCP tools.

## 1. Resolve the project + repo
- `list_spaces` → use the single space, or the one named in `$ARGUMENTS`.
- Identify **this repo's slug** `<repo>` the same way `/teio-start` does (basename
  of the working directory, normalized; prefer a canonical name from
  `package.json`/`.git/config` if clearer). Its context lives under
  `context/repos/<repo>/`.

## 2. Reflect on the session
List the **durable** facts, decisions, and changes from THIS session that belong
in shared context — not transient debugging or half-explorations. If `$ARGUMENTS`
was given, use it as the headline. If nothing is durable, say so and stop.

## 3. Update the affected docs — write to the right altitude
For each topic that changed, `get_document` the doc, merge (edit, don't clobber),
and `propose_update` passing the `baseVersion`/`baseBlob` from that read (create
new files with no base):
- **Repo-specific** (this repo's modules, structure, endpoints) → write under
  `context/repos/<repo>/` (overview.md / components.md, or a topic file there).
- **Project-wide** (a decision, a convention, something spanning repos, or how
  this repo relates to others) → write to the shared layer: `context/overview.md`,
  `context/architecture.md`, or `context/conventions.md`.

## 4. Log the handoff
Handoffs are **one file per day** (concurrent sessions on different days never
touch the same file), plus a thin newest-first **index** that `/teio-start` reads.

**a. Dated file** — `context/handoffs/<YYYY-MM-DD>.md`:
- `get_document` it.
  - **Not found** → create it: `# Handoffs — <YYYY-MM-DD>` then a
    `## <headline> — <me or the agent> (repo: <repo>)` section with 2–5 bullets.
  - **Exists** → append your `## <headline>` section at the bottom and
    `propose_update` with the base you just read (CAS append — don't clobber the day).
  Note **which repo** the session was in, so multi-repo history stays legible.

**b. Index** — `context/handoffs/log.md`:
- `get_document` it. **Not found** → create `# Handoff index\n\n` + your line.
  **Exists** → prepend one line under the header and `propose_update` with the base:
  ```
  - <YYYY-MM-DD> — <headline> (repo: <repo>) → `context/handoffs/<YYYY-MM-DD>.md`
  ```

## 5. Report
Tell me which docs you updated (repo-specific vs shared), and for each write
whether it **merged** (200) or **opened a PR** (202 — propose-only tokens do this;
share the PR URL so a human can review). That's the handoff done.
