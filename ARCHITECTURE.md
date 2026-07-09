# teio-context — v1 Architecture

**Status:** Locked for build · **Date:** 2026-07-09 · **Reviewer pass:** /plan-eng-review
**Revised:** post-Phase-0 spike (absorbs [SPIKE-FINDINGS.md](SPIKE-FINDINGS.md) + 15 outside-voice findings; triage in §14)
**Input:** [SPEC.md](SPEC.md) · **Scope:** design only, no feature code yet.

This doc turns SPEC.md into a buildable v1. Forks resolved in review:

1. **Merge engine runs on the GitHub API, not a local working copy.** Proven in
   Phase 0: GitHub's Git Data + Merges APIs give a real line-level 3-way merge.
2. **v1 consumers = MCP + TEIO.** Customer connector is a fast-follow gated on a
   named pilot. The connector interface is built once regardless.

The spike added two **hard requirements** that are load-bearing for the whole bet:

- **Space repos must live in a paid GitHub org (Team/Enterprise).** Free-tier
  private repos cannot set branch protection or rulesets (§7.1).
- **The App must be a ruleset bypass actor**, with the PR-required rule scoped to
  humans. Otherwise every auto-merge write is blocked with 409 (§3, §6).

---

## 1. System overview

```
                          ┌─────────────────────────────────────────┐
   CONSUMERS              │            teio-context service          │      CANONICAL STORE
                          │        (Next.js App Router, Vercel)      │
 ┌───────────────┐        │                                          │      ┌──────────────────┐
 │ Claude Code / │  MCP   │  ┌────────────┐   ┌───────────────────┐  │ Git  │ GitHub (private, │
 │ Cursor/Codex  │◀──────▶│  │ MCP adapter│──▶│                   │  │ Data │  paid org)       │
 └───────────────┘        │  └────────────┘   │  ContextService   │  │ API  │  repo per space  │
                          │  ┌────────────┐   │  (the one core    │──┼─────▶│ teio-context-acme│
 ┌───────────────┐  REST  │  │ REST routes│──▶│   interface)      │  │Merges│ teio-context-... │
 │ TEIO (Next.js)│◀──────▶│  └────────────┘   │                   │  │Content│teio-ctx-internal│
 └───────────────┘        │        │          └─────────┬─────────┘  │ API  └────────┬─────────┘
                          │        │ authz              │            │               │
 ┌───────────────┐        │  ┌─────▼──────┐   ┌─────────▼─────────┐  │  push + pull_request webhooks
 │ Customer sys  │  (v1.1 │  │Clerk / tok │   │  Neon (pooled)    │  │               │
 │  fast-follow) │  defer)│  │  auth      │   │  control plane +  │◀─┼───────────────┘
 └───────────────┘        │  └────────────┘   │  derived FTS index│  │  webhook → ack fast → async reindex
                          └───────────────────┴───────────────────┴──┘

  Git owns content + version history + 3-way merge (via GitHub API).
  Neon (via the pooled/serverless driver) holds the control plane + a DERIVED
    FTS index (tsvector + snippet only, NOT full context) — rebuildable from git.
  Nothing canonical lives in Neon.
```

**Component boundaries**
- **ContextService** — the single core interface. All reads/writes go through it.
  It is the only thing that talks to GitHub. Adapters never call GitHub directly.
- **Adapters** (MCP, TEIO) — thin protocol translators. Zero business logic.
- **Auth layer** — resolves a principal (Clerk user or machine token) and its role
  on a space before any ContextService call.
- **GitHub App** — the bot identity; also the **ruleset bypass actor** on `main`.
- **Neon** — control plane + derived FTS index. Reached through the pooled
  connection (Neon pooler / `@neondatabase/serverless` HTTP driver), never a raw
  socket per function (§6). Never the source of truth for context.

---

## 2. Data model

### 2.1 Git repo layout (one private repo per space, in a paid org)

```
teio-context-<slug>/            ← e.g. teio-context-acme (private repo, paid org)
  space.yaml                    ← manifest (owner-write only, see below)
  context/
    overview.md
    architecture.md
    decisions/adr-001-*.md
    projects/<project>/*.md
  README.md                     ← seeded at provisioning so main exists before protection
```

Rules enforced by the service:
- **Text-only.** Binary content is rejected at the API (§7.4).
- **Path whitelist + role.** Writes must target `context/**` (role ≥ editor) or
  `space.yaml` (**role = owner only** — it is an owner artifact: owners,
  connectors, policy). Nothing else. (finding #12)
- **PR-required ruleset on `main`**, with the App as bypass actor. Force-push and
  history rewrite disabled. `base_version` integrity depends on old SHAs staying
  reachable (§6, §7.1).

**`space.yaml`** (validated on read; a human-readable mirror of Neon rows):

```yaml
name: Acme Corp
slug: acme
owners: [ravi@teio.ai]
write_back_default: auto_merge_clean   # auto_merge_clean | proposal_only
connectors:
  - kind: mcp
    name: acme-claude-code
    write_back_policy: proposal_only    # external agents → always PR
  - kind: teio
    name: teio-internal
    write_back_policy: auto_merge_clean  # trusted → auto-merge clean
```

**Neon is authoritative** for policy at request time; a reconcile job syncs
`space.yaml` → Neon on push. On disagreement Neon wins and the drift is logged.

### 2.2 Neon schema (field-level)

Postgres via the pooled/serverless driver. Ids `uuid` (pk, `gen_random_uuid()`);
all tables carry `created_at timestamptz not null default now()`.

```sql
spaces (
  id uuid pk, slug text unique not null, name text not null,
  github_owner text not null, github_repo text not null,
  github_installation_id bigint not null,          -- per-space install for busy spaces (§7.1)
  default_branch text not null default 'main',
  current_sha text,                                 -- latest main HEAD; O(1) staleness
  write_back_default text not null default 'auto_merge_clean'
    check (write_back_default in ('auto_merge_clean','proposal_only')),
  status text not null default 'active' check (status in ('active','archived')),
  created_by text not null, updated_at timestamptz not null default now(),
  unique (github_owner, github_repo)
)

space_members (
  id uuid pk, space_id uuid not null references spaces(id) on delete cascade,
  principal_type text not null check (principal_type in ('user','token')),
  principal_id text not null, role text not null check (role in ('owner','editor','reader')),
  created_by text not null, unique (space_id, principal_type, principal_id)
)
-- owner = manage members/connectors/tokens + write space.yaml + editor; editor = read+write context/**; reader = read.

connectors (
  id uuid pk, space_id uuid not null references spaces(id) on delete cascade,
  kind text not null check (kind in ('mcp','teio','customer')), name text not null,
  write_back_policy text not null default 'inherit'
    check (write_back_policy in ('auto_merge_clean','proposal_only','inherit')),
  config jsonb not null default '{}', status text not null default 'active'
    check (status in ('active','disabled')),
  updated_at timestamptz not null default now(), unique (space_id, name)
)

sync_cursors (
  id uuid pk, connector_id uuid not null references connectors(id) on delete cascade,
  last_synced_sha text, last_synced_at timestamptz, last_notified_at timestamptz,
  status text not null default 'current' check (status in ('current','stale','error')),
  unique (connector_id)
)
-- staleness(connector) = spaces.current_sha != sync_cursors.last_synced_sha

api_tokens (
  id uuid pk, space_id uuid not null references spaces(id) on delete cascade,
  name text not null, token_prefix text not null, token_hash text not null,
  role text not null check (role in ('reader','editor')),
  created_by text not null, expires_at timestamptz, last_used_at timestamptz,
  revoked_at timestamptz, unique (token_prefix)
)

-- Append-only. AUTHORITATIVE attribution — NOT the git author field (§6, finding #5).
audit_log (
  id bigserial pk, ts timestamptz not null default now(),
  space_id uuid references spaces(id) on delete set null,
  actor_type text not null,            -- user | token | bot | github
  actor_id text, actor_display text,   -- for pull_request merges: the GitHub approver (finding #7)
  connector_id uuid references connectors(id) on delete set null,
  action text not null,                -- read|cas_write|propose|merge|conflict_pr|pr_merged|delete|move|
                                       --   member_add|token_issue|token_revoke|reindex|backfill
  path text, base_sha text, result_sha text,
  outcome text not null check (outcome in ('ok','conflict','denied','error')),
  request_id text, detail jsonb not null default '{}'
)

proposals (
  id uuid pk, space_id uuid not null references spaces(id) on delete cascade,
  connector_id uuid references connectors(id) on delete set null,
  actor_display text not null, path text not null, base_sha text not null,
  branch_ref text not null, pr_number int, pr_url text,
  status text not null default 'open' check (status in ('open','merged','closed','conflict')),
  resolved_at timestamptz
)
-- backfill reconciles proposal status from pull_request webhooks, not just documents (finding #14)

-- DERIVED FTS index. Rebuildable from git. Stores tsvector + snippet, NOT full body (finding #8).
documents (
  id uuid pk, space_id uuid not null references spaces(id) on delete cascade,
  path text not null, title text,
  snippet text,                        -- first ~200 chars, for search result display only
  fts tsvector not null,               -- computed at index time from git content, then body discarded
  content_sha text not null,           -- blob sha (cheap change detection + CAS base, §3.2)
  commit_sha text not null, updated_at timestamptz not null default now(),
  unique (space_id, path)
)
-- create index documents_fts_idx on documents using gin(fts);
```

**Blast-radius note (finding #8, ADOPT):** the earlier design cached every space's
full markdown in one multitenant Neon DB, which quietly degraded the
"isolation = repo boundary" promise to a `WHERE space_id=` clause. Fix: the index
stores only `tsvector` + a short `snippet` + `title`, **not the full body.** Full
content is fetched from git on `getDocument`. A single Neon read can no longer leak
a client's full corpus; the sensitive body never leaves git. This is an accepted,
reduced trade, documented here rather than hidden behind the word "cache."

---

## 3. Write-back / merge engine (the core)

### 3.1 Policies (two) + the bypass requirement

| Policy | Uncontended | Contended (file changed since base) | True line overlap |
|---|---|---|---|
| `auto_merge_clean` (trusted default) | CAS fast path (1 write) | 3-way auto-merge | open PR |
| `proposal_only` (external/agent) | open PR | open PR | open PR |

Resolution: `connector.write_back_policy` unless `inherit`, then
`spaces.write_back_default`.

**Hard requirement (spike finding #1 / S2, ADOPT):** both write paths land on
`main`, which is PR-protected by a ruleset. The App **must** be a ruleset bypass
actor or every write returns `409 "Changes must be made through a pull request."`
Verified in the spike: without bypass → 409; with the App as bypass actor → 201.

### 3.2 `propose_update` algorithm (revised: CAS fast path → 3-way fallback)

```
propose_update(space, path, content, base_version, base_blob?, actor, connector):

  1. AUTHZ    role >= editor (owner for space.yaml)   else 403 + audit(denied)
  2. VALIDATE UTF-8 text, <= 1 MiB, path in whitelist  else 422
  3. POLICY   p = connector.policy or space default    → auto_merge_clean | proposal_only

  if p == auto_merge_clean:
    ── FAST PATH (common case: single writer, file unchanged since read) ──
    4. blobSha = base_blob or resolve(path @ base_version)   [1 GET if not supplied]
    5. PUT /repos/../contents/{path} { content, sha: blobSha, branch: main,
                                       author: actor }         ← ONE content call
         200/201 → committed directly (no merge commit, no bot-merge noise).
                   current_sha = commit sha; audit(cas_write); return { merged, version }
         409     → file changed since base (CAS miss) → fall to 3-WAY PATH
         404/422 → unknown base/path → 409 unknown_base (re-pull)
    (This subsumes the fast-forward optimization, finding #11: uncontended writes
     never mint a two-parent bot merge commit.)

  ── 3-WAY PATH (CAS miss, or policy == proposal_only) ──
  6. blob→tree(base_tree = tree(base_version), path→blob)→commit(parent=base_version,
     author=actor, committer=bot)  → commit C
  7. if p == proposal_only:
        branch ref → C; open PR (head=branch, base=main); record proposals row
        return { proposal, pr_url, proposal_id }
     else:
        r = POST /merges (base=main, head=C)              ← GitHub server-side 3-way
        201 → merged clean: current_sha = r.sha; audit(merge); return { merged, r.sha }
        204 → head already contained in main (finding #2 / S3): DO NOT write r.sha
              (empty body). Re-resolve main HEAD; treat as no-op success.
        409 → real line overlap: branch ref → C; open PR; record proposals row;
              audit(conflict_pr); return { conflict, pr_url, proposal_id }
        404 → base/head vanished (race) → retry vs latest main (max 3) → 409 unknown_base
```

`delete_path` / `move_path` use the 3-way path (tree edit removing/renaming the
path); delete-vs-edit → conflict PR. The Merges API computes merge-base =
`base_version`, so non-overlapping edits merge cleanly even when `main` advanced
(spike-confirmed).

### 3.3 Write-back sequence

```
Consumer         teio-context (ContextService)         GitHub API          Neon
  │ propose_update(path, content, base=B, blob=b)       │                  │
  ├────────────▶ authz + validate ─────────────────────┼──── check ──────▶│
  │  auto_merge_clean → FAST PATH:                       │                  │
  │              PUT /contents (sha=b, branch=main) ─────▶ 200/201 ─────────┤
  │  { merged, version } ◀── set current_sha ───────────┼──── audit ──────▶│
  │              ── OR 409 CAS miss → 3-WAY PATH ──      │                  │
  │              blob→tree→commit(parent=B)              │                  │
  │              POST /merges base=main head=C ──────────▶ 201 / 204 / 409  │
  │  { merged | conflict PR } ◀──────────────────────────┤  audit/proposal ▶│
```

### 3.4 Failure modes

| Failure | Detection | Handling | Silent? |
|---|---|---|---|
| Uncontended write | CAS 200/201 | one call, direct commit | no |
| File changed since base | CAS 409 | fall to 3-way (line merge) | no |
| Non-overlapping concurrent edits | Merges 201 | auto-merged | no |
| Head already merged | **Merges 204** | re-resolve main SHA, no-op (do NOT set empty sha) | no |
| True line overlap | Merges 409 | open PR | no |
| Stale/unreachable base | 404/422 | 409 `unknown_base` (needs ruleset force-push protection) | no |
| Binary / oversize | step 2 | 422 | no |
| Secondary rate limit (403) | header | 429 `Retry-After` to caller; queue = triggered follow-up (§7.1, finding #5) | no |
| Missing bypass actor | Merges/PUT 409 "PR required" | provisioning bug — fail loud (§6) | no |

---

## 4. Connector interface

One core interface, `ContextService`. Adapters are thin.

```ts
interface ContextService {
  // OUT
  listSpaces(principal): Promise<SpaceSummary[]>
  getVersion(principal, spaceId): Promise<{ sha; updatedAt }>
  getDocument(principal, spaceId, path): Promise<{ path; content; version; blob }>  // blob → CAS
  search(principal, spaceId, query, opts?): Promise<SearchHit[]>                     // path + snippet
  listProposals(principal, spaceId): Promise<Proposal[]>
  // IN
  proposeUpdate(principal, spaceId, { path; content; baseVersion?; baseBlob? }): Promise<WriteResult>
  deletePath(principal, spaceId, { path; baseVersion? }): Promise<WriteResult>
  movePath(principal, spaceId, { from; to; baseVersion? }): Promise<WriteResult>
}
type WriteResult =
  | { status: 'merged'; version: string }
  | { status: 'proposal' | 'conflict'; prUrl: string; proposalId: string }
// Every method takes a resolved Principal and re-checks authz.
```

`getDocument` returns `blob` (the file's blob sha) so a consumer can round-trip it
back as `baseBlob` and hit the 1-call CAS fast path.

**MCP adapter** maps tools 1:1 (`list_spaces`/`get_version`/`get_document`/`search`/
`list_proposals`/`propose_update`/`delete_path`). Launched with a per-space token;
default policy `proposal_only`.

**TEIO adapter** — a typed HTTP client TEIO imports; calls the REST surface with a
machine token or forwarded Clerk session. Default policy `auto_merge_clean`.

**Customer adapter (v1.1):** same interface over REST + a customer webhook; built
when a named pilot fixes auth + data mapping (§8).

---

## 5. API + MCP surface

Every route resolves a principal and checks space role **before** any git/Neon
work. Reads return `version` (commit SHA) + `blob`; writes take `base_version`.

```
GET    /api/spaces                              → [SpaceSummary]              (member)
GET    /api/spaces/:id/version                  → { sha, updatedAt }          (reader+)
GET    /api/spaces/:id/context?path=…           → { path, content, version, blob }  (reader+)
GET    /api/spaces/:id/search?q=…               → [{ path, title, snippet }]  (reader+)
POST   /api/spaces/:id/context                  → WriteResult { path, content, base_version?, base_blob? }  (editor+)
DELETE /api/spaces/:id/context?path=…&base_version=…  → WriteResult           (editor+)
POST   /api/spaces/:id/context:move             → WriteResult { from, to, base_version? }  (editor+)
GET    /api/spaces/:id/proposals                → [Proposal]                  (reader+)
# Admin
POST   /api/spaces                              → create + provision (§6)     (staff)
POST   /api/spaces/:id/members | /tokens | /connectors | /import              (owner)
# Infra
POST   /api/webhooks/github                     → push + pull_request sink (HMAC)  (async, §6)
GET    /api/health
# Vercel Cron → POST /api/cron/backfill         → reconcile documents + proposals
```

MCP tools mirror the context-plane reads/writes. No admin over MCP in v1.

---

## 6. Auth, provisioning, and freshness

**Humans (Clerk).** Reuse TEIO's Clerk instance. A session → `user` principal;
role from `space_members`.

**Machines (per-space tokens).** `tctx_<slug>_<random32>`; only `sha256` + 12-char
prefix stored. Look up by prefix, constant-time compare, check expiry/revocation.
Shown once at issue.

**Git ops run under a GitHub App bot.** One App per org (or **per-space
installation for busy spaces**, §7.1). Per op the service mints a short-lived
installation token (~60 min, cached; spike-confirmed). Least-privilege: `contents:
write`, `pull_requests: write`, `administration: write` (to manage the ruleset),
`metadata: read`.

**Neon access.** Functions use the **pooled connection string / `@neondatabase/
serverless` HTTP driver** — never a raw socket per invocation, or serverless
concurrency exhausts Postgres connections (finding #6, ADOPT).

**Provisioning a space (order matters — findings #1, #3):**
```
1. create private repo in the PAID org
2. seed an initial commit (README.md + space.yaml) so `main` EXISTS      (finding #3)
3. create a branch ruleset on main: rule=pull_request (required),
   bypass_actors=[{ App, mode: always }], force-push + deletion disabled (finding #1)
   ── requires a paid org; fail loud at provisioning if the ruleset PUT 403s (§7.1)
4. write spaces row + owner membership
```

**Attribution (authoritative = audit_log, not git metadata).** `author` and
`committer` are arbitrary caller-set fields (spike-confirmed: both are just
labels). "Who changed line X" joins the commit SHA → `audit_log` (authenticated
principal + token id + request id). For the **PR-merge path** (an MCP
`proposal_only` write that a human merges in GitHub's UI), the direct-write audit
row is not enough — so the **`pull_request` (merged) webhook is reconciled into
`audit_log` with the GitHub approver** (finding #7, ADOPT). Without this, the
primary v1 write path has no approver record.

**Change detection & freshness (findings #14, #15):**
- Webhook subscribes to `push` + `pull_request`. Handler **acks fast, reindexes
  async**; idempotency keyed on `X-GitHub-Delivery` + head SHA (a synchronous
  full-space reindex risks GitHub's ~10s timeout → retries → duplicates).
- On push to main: update `spaces.current_sha`, reindex changed paths into
  `documents`, mark cursors stale. On `pull_request` merged/closed: update the
  `proposals` row + audit the approver.
- **Backfill cron** (Vercel Cron): `GET ref` per active space; if real head !=
  `current_sha`, reindex. **Also reconciles `proposals` status** so a dropped
  `pull_request` webhook doesn't leave stale `open` rows forever (finding #14).

---

## 7. Pressure-test verdicts

### 7.1 Git-as-database at scale — VERDICT: GO, with a paid-org requirement

**Hard requirement (spike S1):** private-repo branch protection + rulesets are
**unavailable on GitHub's free tier** (spike hit hard 403s). Space repos MUST live
in a **paid org (Team/Enterprise)**. This is a cost line, not optional.

| Dimension | Where it breaks | Mitigation | Trigger to switch |
|---|---|---|---|
| **Secondary rate limit** | The real cap is the **content-creation secondary limit (~80/min, ~500/hr) per installation** (spike S4) — NOT the 15k/hr primary | CAS fast path = **1 content call/write** (~500 writes/hr common case) vs 4 for the 3-way path (~125/hr); **per-space App installations** = separate buckets; ETag reads free | sustained 403s that CAS + per-space installs can't absorb |
| **Merge latency** | 3-way path ~600ms–1.5s; CAS ~1 call | acceptable for a context store; 429 `Retry-After` under limit | p95 write > 2s with users waiting → add queue |
| **Repo growth** | large/binary blobs | text-only + 1 MiB cap | n/a for markdown |
| **Webhook reliability** | GitHub drops/dups | HMAC + idempotent async handler + backfill cron | n/a |
| **Import** | N-file seed hits secondary cap + Vercel timeout (finding #13) | chunk tree building, run import **off the request path** | n/a |

**Queue reality (finding #5, ADOPT):** v1 is **synchronous**; under a secondary
limit it returns **429 `Retry-After`** to the caller (no silent loss, no fake
in-function queue). A real durable queue (QStash/Inngest) is a **triggered
follow-up**, not claimed as present in v1.

**Hard trigger to reconsider git-as-store:** cross-space relational queries at
scale, or sub-100ms writes. Neither is in v1/v2. Fallback stays the persistent-git
worker (documented, not needed — spike proved GitHub's merge works).

### 7.2 Bot-author authz — VERDICT: safe and attributable IF

1. `audit_log` is authoritative (git author is spoofable — spike-confirmed), **and
   the `pull_request` merged webhook feeds the approver into it** (finding #7).
2. The **PR-required ruleset** with the App as **bypass actor** is provisioned
   (§6); PR rule scoped to humans.
3. Least-privilege App + short-lived tokens.

Bypasses: direct GitHub collaborators skip our authz/audit — keep that set tiny;
the ruleset still forces humans through PR. One org-wide installation can write all
space repos; authz maps token→space before any op; **per-space installations**
give a harder boundary for demanding customers (deferred, §11).

### 7.3 Search — VERDICT: keyword adequate for v1; Postgres FTS, not GitHub code search
`documents.fts` (tsvector + snippet, body fetched from git on hit). Semantic /
embeddings is a later add; trigger: a space exceeds a few hundred docs.

### 7.4 Concurrency edges — VERDICT: covered
Two proposals same file (CAS miss → 3-way → clean or PR); stale base (3-way vs
merge-base, needs force-push protection); delete/rename (verbs + conflict PR);
binary/oversize (rejected); force-push (ruleset-blocked — spike-confirmed 422).

---

## 8. Consumer scope — VERDICT: MCP + TEIO for v1 (unchanged)
Customer connector deferred: a "generic" adapter with no named target is
speculative generality. The interface is built regardless, so the customer adapter
is cheap once a pilot fixes its unknowns. (See finding #10 in §14 for the market-
risk counterpoint — noted, not adopted; it is a `/plan-ceo-review` question, not an
architecture one.)

---

## 9. Test coverage plan

Deepest coverage on **merge engine + authz**.

**Unit (mock GitHub + Neon):**
- CAS fast path: 200 → direct commit, current_sha set  ★★★
- CAS 409 → falls to 3-way path  ★★★
- 3-way clean → Merges 201  ★★★ · conflict → 409 → PR  ★★★ · **204 → no-op, sha not overwritten**  ★★★
- `proposal_only` → PR even when clean  ★★★ · `unknown_base` → 409  ★★★ · ref race → retry ≤3 → PR  ★★★
- binary/oversize → 422  ★★★ · delete-vs-edit → conflict PR · move  ★★★
- authz role matrix; cross-space token denied; expired/revoked → 401; no membership → 403; **space.yaml write requires owner**  ★★★
- token hash constant-time compare  ★★

**Integration (throwaway repo / recorded fixtures):**
- Provisioning: seed commit → ruleset with App bypass → App write succeeds (bypass works)  [→E2E]
- Full round trip: create → import → read(SHA+blob) → CAS write → read new SHA  [→E2E]
- Overlapping write → PR; main unchanged  [→E2E]
- Push webhook → async reindex → cursor stale  [→E2E]
- **pull_request merged webhook → approver in audit_log**  [→E2E]
- Dropped webhook → backfill reconciles documents **and proposals**  [→E2E] (regression-critical)
- Missing-bypass-actor → write fails loud with a clear provisioning error  [→E2E]
- MCP + TEIO adapter round trips  [→E2E]

Everything is a GAP (greenfield); no merge-engine or authz path lands without a
★★★ test.

---

## 10. Implementation plan (riskiest work front-loaded)

**v1 status: all phases shipped ✅** (Phases 0–5 merged to `main`; 87 tests, tsc
+ build green). This section is retained as the record of how it was sequenced.

```
PHASE 0 — De-risking spike  ✅ DONE (SPIKE-FINDINGS.md): GO.
  Proved 3-way merge (201/409/204), installation-token identity, force-push block,
  call cost, and finding #1 (App bypass actor). Surfaced the paid-org requirement.

PHASE 1 — Foundations
  Neon schema + migrations (pooled driver) · GitHub App (JWT→install token) ·
  Clerk · space provisioning (seed commit → PR-required ruleset + App bypass; fail
  loud if 403/free-tier) · ContextService skeleton + GitHub client.
  Done: create a space (with ruleset), authorize a member, service reads the repo.

PHASE 2 — Share OUT + authz middleware   (authz early — everything depends on it)
  Authz layer (role matrix, token verify, space.yaml=owner) · GET version/context
  (+blob)/search · Postgres FTS (tsvector+snippet) · MCP read tools.

PHASE 3 — Update IN (merge engine)   CROWN JEWEL, most test budget
  CAS fast path → 3-way fallback · 204/409/unknown_base handling · two policies ·
  delete/move · proposals table · ref-race retry · binary/size guards.

PHASE 4 — Connectors + discover  (MCP + TEIO only)
  MCP adapter · TEIO HTTP client · discover/import (off-request, chunked tree).

PHASE 5 — Freshness + operations
  Webhook (HMAC, ack-fast, async reindex, idempotency) · push + pull_request
  handling · cursors/staleness · backfill cron (documents + proposals) · audit
  incl. PR approver · hardening (token rotation, 429 Retry-After, error paths,
  orphan proposal-branch GC).
```

**Parallelization:** Phase 0 done. Lanes A (control plane: `db/`, `lib/auth/`,
`app/api/admin/`) + B (git engine: `lib/github/`, `lib/context/`) in parallel after
agreeing the `spaces` migration as one shared commit. Then C (search/index +
webhooks). Then D (adapters). A and B both reference `spaces` — land that migration
first or they collide.

---

## 11. NOT in scope (v1)
Customer connector (needs pilot) · semantic search · web editing UI · doc-level
ACLs · real-time push · local-git worker · durable write queue (triggered
follow-up) · per-space App installations as default (used only for busy/demanding
spaces) · multi-region.

## 12. What already exists (reuse, don't rebuild)
git/GitHub (merge, versioning, isolation, PRs, webhooks, rulesets) · Clerk · Neon ·
1Password. Net new code is thin: ContextService + GitHub client, authz, two
adapters, webhook/backfill, Neon schema.

## 13. TODOs
1. **Ruleset provisioning** — seed commit → PR-required ruleset + App bypass actor;
   fail loud on free-tier 403. (Phase 1; supersedes the old "branch protection" TODO.)
2. **Durable write queue** (QStash/Inngest) — only if p95 climbs or 429s recur. (Triggered.)
3. **Orphan proposal-branch GC** — clean `proposal/*` with no open PR. (Phase 5.)
4. **Per-space App installations** — separate rate buckets + harder isolation for
   busy/demanding spaces. (Triggered.)

---

## 14. Findings triage (Phase 0 spike + outside-voice pass)

Spike (SPIKE-FINDINGS.md): all four parts + finding #1 verified → **GO**, plus the
paid-org requirement (S1) and App-bypass-actor requirement (S2), 204 (S3), and the
real ~500/hr secondary cap (S4) — all **ADOPTED** above.

| # | Finding (outside voice) | Verdict | Where |
|---|---|---|---|
| 1 | Branch-protection self-contradiction; need App as ruleset bypass actor | **ADOPT** (spike-confirmed) | §3.1, §6 provisioning |
| 2 | `POST /merges` 204 unhandled | **ADOPT** (spike-confirmed) | §3.2, §3.4 |
| 3 | Empty-repo/first-commit bootstrap missing | **ADOPT** | §6 provisioning step 2 |
| 4 | Wrong rate ceiling (secondary ~500/hr, not 15k) | **ADOPT** (spike-confirmed) | §7.1 |
| 5 | Backoff/queue/202 was vaporware | **ADOPT** | §7.1 (429 Retry-After; queue = triggered) |
| 6 | Neon + serverless connection exhaustion | **ADOPT** | §6 pooled driver |
| 7 | Default write escapes audit_log (human merges PR in UI) | **ADOPT** | §6 pull_request reconciliation |
| 8 | `documents.content` re-centralizes all context | **ADOPT** (reduced to tsvector+snippet) | §2.2 blast-radius note |
| 9 | Merge engine over-built; Contents-API CAS fast path | **ADOPT** | §3.2 fast path |
| 10 | Build order optimizes eng risk, not market risk | **DEFER** — contradicts locked MCP+TEIO scope; conscious accept; revisit via /plan-ceo-review | §8 |
| 11 | No fast-forward path (bot merge-commit noise) | **ADOPT** (subsumed by CAS direct commit) | §3.2 |
| 12 | `space.yaml` writable at editor role | **ADOPT** | §2.1, §2.2, §9 |
| 13 | Large import hits secondary cap + Vercel timeout | **ADOPT** | §7.1, §10 Phase 4 (off-request, chunked) |
| 14 | `proposals.status` drifts (backfill ignores it) | **ADOPT** | §6 backfill, §2.2 |
| 15 | Synchronous webhook reindex risks 10s timeout | **ADOPT** | §6 ack-fast async + idempotency |

Confirmed by both the review and the spike: `POST /merges` is a genuine line-level
3-way merge with merge-base = the proposal branch point, given force-push
protection. The core bet holds.
