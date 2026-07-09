# teio-context — v1 Spec

**Status:** Draft for review · **Date:** 2026-07-09 · **Author:** ravi
**Scope of this pass:** understand + spec only. No code.

teio-context is a lightweight, standalone shared-context layer. It holds the
canonical context about our clients and our internal platform, and serves it,
two ways, to the people and systems that need it: our clients and their
platforms, our internal TEIO app, and AI coding tools (Claude Code / Cursor /
Codex). It is separate from TEIO; TEIO is one consumer among several.

The one feature that makes it worth building is the **two-way link**: context
is not just exported out to an external platform, it is updated back in from
that platform so the canonical copy never goes stale.

---

## 1. What we took from Indigo HQ, and what we cut

HQ is a filesystem-first "operating system for AI workers." Its content layer is
already git: each knowledge base is an independent git repo of plain markdown.
On top of that it bolts an S3 + KMS + Cognito + STS cloud layer for enterprise
isolation and cross-device sync, plus a large product surface (workers,
commands, checkpoints, a secrets vault, a package marketplace).

| HQ concept | Keep / Cut | Why |
|---|---|---|
| Knowledge = git-versioned markdown | **Keep** | This is the core. Git gives versioning + 3-way merge for free. |
| Spaces / companies | **Keep the idea, cut the machinery** | One private git repo per space. GitHub repo perms = isolation. No S3/KMS/Cognito/STS. |
| MCP interface for agents | **Keep** | This is how AI tools pull/query context. Central. |
| Discover (import) | **Keep, minimal** | Seed a space from an existing repo/docs. |
| Handoff / learn | **Keep, reframed** | These become the write-back leg of two-way sync. |
| Cloud Sync (chokidar + S3, last-write-wins) | **Cut, replace with git** | Git is a better bidirectional merge engine than a last-write-wins S3 journal. |
| Secrets vault (hq-secrets / hq-share) | **Cut** | Stay on 1Password. Context stores 1Password references, never secret values. |
| Workers, commands, checkpoints/threads | **Cut** | HQ's own agent runtime. We serve context to other agents; we don't run them. |
| hq-packages marketplace | **Cut** | Non-goal for v1. |

**Biggest simplification over HQ:** GitHub is both the git layer and the
isolation layer. Private repos, per-repo access control, PRs, and webhooks
already exist. We delete HQ's entire S3/KMS/Cognito/STS stack.

---

## 2. Architecture (decided)

**Store:** git-for-content + Neon thin control plane. Context lives only in git.
Postgres never holds context, only pointers and policy.

```
  GIT (content)                    NEON / POSTGRES (thin control plane)
  ─────────────                    ────────────────────────────────────
  markdown context                 space registry
  full version history             space_members + roles (Clerk-keyed)
  3-way merge engine               connector config + write-back policy
  branches / PRs                   sync cursors (per external platform)
  GitHub perms = isolation         audit log, machine API tokens
```

**A "space" = one private GitHub repo.** One per client, plus one for our
internal platform.

```
teio-context-acme/            ← client "Acme" space (private repo)
  space.yaml                  ← manifest: name, connectors, write-back policy, owners
  context/
    overview.md
    architecture.md
    decisions/adr-001.md
    projects/
      billing/notes.md
      onboarding/notes.md
teio-context-internal/        ← our own TEIO platform space
teio-context-globex/          ← client "Globex" space
```

- **Multiple clients** → separate repos. Isolation is the GitHub repo boundary.
- **Multiple projects** → folders inside a space; API/MCP scope queries to a path.
- **Multiple users** → a `space_members(user_id, space_id, role)` table in Neon,
  keyed on Clerk identity. Reads/writes through API or MCP check that table; the
  service performs the git op with a bot identity, stamping the real person as
  commit author. Only engineers who want raw `git clone` get GitHub collaborator
  access directly.
- **Concurrent edits from different platforms** → git branches + 3-way merge.

**Stack:** Next.js App Router + Neon + Clerk (mirrors TEIO, so integration is
trivial and there is nothing new to learn). Hosted on Vercel.

**One connector surface, three shapes:**
- **Git** — the storage + sync substrate. Direct `git` for power users.
- **REST/JSON API** — pull (share OUT) + push (update IN) for apps.
- **MCP server** — `list_spaces`, `search`, `get_document`, `propose_update`
  for AI coding tools.

Every consumer uses a subset of that one surface. The three consumers (AI tools,
TEIO, customers) are **thin adapters over the same interface.**

**Auth:** reuse Clerk for humans. Machine/agent access uses per-space API tokens.
Direct git access uses GitHub repo permissions. No bespoke auth.

**Secrets:** none stored. 1Password stays the vault. Context may hold 1Password
item references, never secret values.

---

## 3. The bidirectional external-sync flow (the core feature)

### Share OUT (pull)

```
Consumer (Claude Code / TEIO / Customer platform)
  │  MCP.search / MCP.get_document
  │  or  GET /api/spaces/{id}/context?path=projects/billing/notes.md
  ▼
teio-context service
  │  1. authenticate (Clerk session or machine token)
  │  2. authorize (space_members check for {user/token, space, read})
  │  3. read from git: space repo @ main
  ▼
returns  { path, content(markdown), version = commit SHA }
```

The commit SHA is the version handle. Consumers keep it. It is how we later
detect who is stale and how we merge writes safely.

### Update IN (write-back — this is what keeps context fresh)

```
Consumer edits / an agent "learns" something
  │  MCP.propose_update
  │  or  POST /api/spaces/{id}/context
  │       { path, content, base_version = SHA the consumer read, actor }
  ▼
teio-context service
  │  1. authn + authz (space_members check for write)
  │  2. branch from base_version, commit with actor as author
  │  3. attempt merge into main:
  │        ├─ clean (no overlap)      → AUTO-MERGE to main   (default)
  │        └─ conflict (overlap)      → open PR, pause for human
  │  4. write-back policy from space.yaml can override per connector:
  │        - trusted (TEIO, our engineers) → commit direct to main
  │        - external (customer, agent)    → always PR, even if clean
  ▼
new main SHA  →  bump space version  →  notify registered cursors
```

**Conflict handling = git 3-way merge.** Non-overlapping edits from two
platforms at once merge automatically. Real overlaps become one PR a human
resolves once. This is strictly better than HQ's last-write-wins, and we write
almost none of it ourselves.

**Optimistic concurrency via `base_version`.** A write carries the SHA it was
based on. If `main` moved since, we merge the change onto the new `main` (3-way)
rather than clobbering. This is how "both sides changed" is handled correctly.

### Change detection / freshness

- **GitHub webhook** on push to a space repo → service reindexes the space and
  bumps its version.
- **Per-connector sync cursor** (last-synced SHA) in Neon. A consumer is *stale*
  when its cursor is behind `main`. The service can notify it or the consumer
  polls `GET /api/spaces/{id}/version` and re-pulls when the SHA changed.

---

## 4. Feature list (ranked)

Each: **What** (one line) · **Why** (what breaks without it) · **Purpose** (the
outcome).

### Must-have v1

1. **Spaces as private git repos**
   What: one private GitHub repo per client and one for internal.
   Why: without it there is no isolated, versioned canonical store; clients leak
   into each other.
   Purpose: hard per-client isolation for free, using perms we already trust.

2. **Space manifest (`space.yaml`)**
   What: per-space config for owners, connectors, and write-back policy.
   Why: without it write-back trust and connector wiring have nowhere to live.
   Purpose: per-space control of who can push and how.

3. **Neon control plane**
   What: space registry, `space_members` + roles, connector config, sync
   cursors, audit log, API tokens.
   Why: without it there is no authorization, no staleness tracking, no audit.
   Purpose: identity, access, and sync bookkeeping without putting context in a DB.

4. **Auth: Clerk (humans) + machine API tokens**
   What: reuse TEIO's Clerk; issue per-space tokens for agents/apps.
   Why: without it anyone can read any client's context.
   Purpose: developer-level access that reaches people and machines, no bespoke auth.

5. **Read/pull API + MCP read tools (share OUT)**
   What: `GET /context`, plus MCP `list_spaces` / `search` / `get_document`.
   Why: without it context is trapped; nothing can consume it.
   Purpose: any consumer can pull the right context on demand, with a version handle.

6. **Write-back engine: proposal + auto-merge-clean (update IN)**
   What: inbound writes branch, commit, auto-merge if clean, PR if conflicting;
   configurable per connector, default auto-merge-clean.
   Why: without it the tool is a read-only export and context goes stale. This is
   the reason to build the tool.
   Purpose: changes made anywhere flow back to canonical safely.

7. **Conflict handling via git 3-way merge**
   What: unmergeable overlaps surface as a PR; clean merges are automatic.
   Why: without it concurrent edits clobber each other.
   Purpose: "both sides changed" resolves correctly, mostly automatically.

8. **Change detection: GitHub webhooks + sync cursors**
   What: push webhook bumps version; per-connector cursor tracks last-synced SHA.
   Why: without it consumers never learn context moved; freshness claim is empty.
   Purpose: consumers know when to re-pull; we can see who is stale.

9. **Three connectors as thin adapters over one interface**
   What: (a) MCP for AI tools, (b) TEIO REST adapter, (c) generic customer
   REST+webhook adapter.
   Why: without adapters the three named consumers can't actually connect.
   Purpose: all three consumers get the full two-way round trip.

10. **Discover / import (seed a space)**
    What: import an existing repo or doc set into a space's `context/` as markdown.
    Why: without it every space starts empty and adoption stalls.
    Purpose: stand up a useful space in minutes, not weeks.

11. **Audit log + sync status**
    What: who read/wrote what, when; per-space/per-connector sync state.
    Why: without it we can't debug drift or answer "who changed this."
    Purpose: trust and operability for a system multiple parties write to.

### Later (explicitly deferred, with why)

- **Semantic search / embeddings** — v1 uses keyword + path + git grep. Add a
  qmd-style index later. Why defer: keyword search is enough to prove value.
- **Web dashboard for browsing/editing** — v1 is git + API + MCP. Why defer: our
  consumers are apps and agents; humans can use GitHub's UI meanwhile.
- **Doc-level ACLs** — v1 authorizes at the space level. Why defer: repo-per-space
  already isolates the sensitive boundary (client vs client).
- **Real-time push to consumers** — v1 is pull + webhook. Why defer: polling a
  version SHA is cheap and enough.
- **Self-serve customer onboarding / many pilot connectors** — v1 proves one
  named pilot. Why defer: prove the generic adapter once first.
- **Context-usage analytics** — Why defer: not needed to deliver shared context.

---

## 5. v1 delivery in five phases

Effort is rough, shown as human-team / with Claude Code.

### Phase 1 — Foundations
Space model, git repo provisioning (create/clone private repo per space),
`space.yaml` schema, Neon control plane (registry, members, roles, tokens),
Clerk wiring. Next.js app skeleton on Vercel.
**Done when:** a space can be created, a member authorized, and its repo read by
the service. *(~1 wk / ~1 day)*

### Phase 2 — Share OUT (read path)
REST `GET /context` + `GET /version`, and MCP server with `list_spaces`,
`search`, `get_document`. Authn/authz on every call. Version SHA returned.
**Done when:** Claude Code and a curl client both pull a document and its SHA
from a space they're authorized for, and are denied on one they're not.
*(~1 wk / ~1 day)*

### Phase 3 — Update IN (write path + merge)
`POST /context` and MCP `propose_update` with `base_version`. Branch → commit →
auto-merge-clean → PR-on-conflict. Per-connector write-back policy from
`space.yaml` (default auto-merge-clean; trusted=direct; external=always-PR).
**Done when:** two simulated platforms write the same space; non-overlapping
edits auto-merge, an overlapping edit opens a PR; policy override works.
*(~1.5 wk / ~2 days)*

### Phase 4 — Connectors + discover
The three thin adapters (MCP / TEIO / generic customer REST+webhook) over the
Phase 2–3 interface. Discover importer to seed a space from a repo/doc set.
**Done when:** all three consumers complete a full round trip (pull, edit, push
back, see it in canonical), and a space can be seeded by import.
*(~2 wk / ~2–3 days — the customer adapter carries the most unknowns.)*

### Phase 5 — Freshness + operations
GitHub webhook → reindex + version bump. Sync cursors + staleness surfacing.
Audit log. Hardening: token rotation, rate limits, error paths (bad SHA, deleted
path, unauthorized write), backfill on missed webhooks.
**Done when:** a change in one consumer is detectable as stale by the others; the
audit log shows every read/write; the failure paths are covered by tests.
*(~1.5 wk / ~2 days)*

**Dependency order:** 1 → 2 → 3 → 4, with 5 layered after 3 (needs the write path
to have something to detect). Phases 2 and 3 are the spine; 4 is breadth; 5 is the
"never goes stale" promise made real.

---

## 6. Out of scope for v1

- Custom secrets vault (stay on 1Password).
- Package/marketplace ecosystem.
- Bespoke auth (reuse Clerk).
- Heavyweight multi-tool cloud-sync infra (git + GitHub is the sync layer).
- HQ's worker/command/agent runtime.
- Semantic embeddings, web editing UI, doc-level ACLs, real-time streaming
  (all deferred, see §4 "Later").

## 7. Open risks

- **Customer connector unknowns.** "All three consumers" includes a customer
  platform we haven't named. Mitigation: build a *generic* REST+webhook adapter,
  prove it against one named pilot, treat others as "Later."
- **Bot-identity commits.** Writes go through a bot with the real person as
  author. Need the audit log to make attribution unambiguous.
- **Missed webhooks.** GitHub webhooks can drop. Phase 5 includes a
  version-poll backfill so we never silently miss a change.
