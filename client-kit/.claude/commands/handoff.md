---
description: Persist what this session learned back into teio-context — update the affected docs and log the handoff.
argument-hint: "[short summary of what changed]"
allowed-tools: Read, Glob, Grep, mcp__teio-context__list_spaces, mcp__teio-context__get_document, mcp__teio-context__search, mcp__teio-context__propose_update
---

You are ending a work session on a teio-context-backed project. Persist what
changed so the next person or agent picks it up on their `/startwork`.

## 1. Resolve the project
- `list_spaces` → use the single space, or the one named in `$ARGUMENTS`.

## 2. Reflect on the session
List the **durable** facts, decisions, and changes from THIS session that belong
in shared context — not transient debugging or half-explorations. If `$ARGUMENTS`
was given, use it as the headline. If nothing is durable, say so and stop (don't
write noise).

## 3. Update the affected context docs
For each topic that changed:
- `get_document` the relevant doc (e.g. `context/overview.md`,
  `context/architecture.md`, `context/components.md`, or a topic-specific file).
- Merge the new information in — **edit, don't clobber**; preserve what's there.
- `propose_update` with the merged content, passing the `baseVersion` and
  `baseBlob` from the `get_document` you just did (clean optimistic-concurrency
  write). If a topic file doesn't exist yet, create it (no base needed).

## 4. Log the handoff
- `get_document("context/handoffs/log.md")` — it may not exist yet.
- **Prepend** a new entry at the top (newest first), then `propose_update` it:
  ```
  ## <YYYY-MM-DD> — <me or the agent>
  - <2–5 bullets: what changed, decisions made, anything the next session should know>

  <existing log content below>
  ```

## 5. Report
Tell me which docs you updated, and for each write whether it **merged** (200) or
**opened a PR** (202 — propose-only tokens do this; share the PR URL so a human
can review). That's the handoff done.
