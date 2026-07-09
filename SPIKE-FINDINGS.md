# Phase 0 Spike — Findings

**Date:** 2026-07-09 · **Repo:** throwaway `ravi-teio/teio-context-spike-throwaway` (deleted after)
**Bet under test:** a fully serverless, git-backed, 3-way-merge context store using
GitHub's API as the merge engine (ARCHITECTURE.md §3, §7).
**Method:** runnable Node harness against a real repo, commits/merges via a real
**GitHub App installation token** (App id 4256555, short-lived, minted from JWT).

## Verdict: **GO** — with two hard requirements the spike surfaced

The core bet holds: GitHub's Git Data + Merges APIs give a genuine line-level
3-way merge with no local working copy, so the store can run fully serverless.
Two conditions are non-negotiable and were *not* in the original architecture:

1. **Space repos must live in a paid GitHub org (Team/Enterprise).** On the free
   tier, **private repos cannot have branch protection or rulesets** (hard 403).
   Since spaces are private repos, `base_version` integrity (force-push
   protection) and the bypass-actor fix below are simply unavailable on free.
   This is a cost/config line item, not optional.
2. **The App must be a ruleset bypass actor** for `auto_merge_clean` to work.
   PR-required protection blocks the App's direct `POST /merges` (verified 409).
   Adding the App as a bypass actor makes it succeed (verified 201).

If either is missing, the write path is dead-on-arrival. Both are cheap once known.

---

## Part-by-part results

### 1. 3-way merge via the Merges API — behaves as assumed ✓

Base `B` = a commit adding `notes.md` (5 lines). `main` then advanced (edited
line1). A proposal branched from `B`:

| Scenario | Proposal edit | Result | Assertion |
|---|---|---|---|
| **Clean** | line5 (non-overlapping with main's line1) | **HTTP 201, auto-merged** | result `main` has BOTH `line1-MAIN` and `line5-EDIT` — true 3-way, no clobber |
| **Conflict** | line1 (overlaps main's line1) | **HTTP 409** | conflict reported; PR opened; `main` unchanged |
| **Already-merged** | head already in main | **HTTP 204** | must be handled explicitly (see finding #2) |

Merge-base = the proposal branch point (`B`), confirmed by the clean case merging
two disjoint edits without conflict. **This is the whole bet, and it works.**

### 2. Machine identity — installation token works; author/committer are labels ✓ (with a caveat)

- Commits were made with a **short-lived App installation token** (minted from an
  App JWT; `expires_at` ≈ 1 hour). This is the identity model the architecture wants.
- `author` and `committer` are **both fully caller-set.** With `committer` set
  explicitly: `author = Real Actor <actor@teio.ai>`, `committer =
  teio-context[bot]`. With `committer` omitted, GitHub defaults it to the author
  (not the bot).
- **Caveat that confirms the review:** because these fields are arbitrary strings
  the caller chooses, they are **labels, not evidence.** Attribution MUST come
  from `audit_log` (authenticated principal + installation token + request id →
  commit SHA), never from the commit's author string. (ARCHITECTURE §7.2 holds.)

### 3. Branch protection blocks force-push — yes, on a paid tier ✓ / ✗ on free

- Enabling protection (`enforce_admins=true, allow_force_pushes=false`) → **HTTP 200**
  (on a public/eligible repo).
- Force-update of `main` to an older commit → **HTTP 422 "Cannot force-push to
  this branch."** So `base_version` integrity is enforceable. ✓
- **But** on a **free-tier private repo** the protection PUT returns **403
  "Upgrade to GitHub Pro or make this repository public."** So this only works on
  a paid org for private repos. (Requirement #1 above.)

### 4. Rate-limit cost per write — measured ✓ (worse ceiling than assumed)

- One clean write = **6 total GitHub API calls**, of which **4 are
  content-creating** (blob, tree, commit, merge). Primary core limit dropped 6
  (5000/hr) — not the binding constraint.
- **Binding limit is the SECONDARY content-creation cap** (~80/min, ~500/hr) **per
  installation**, which `/rate_limit` does not show. At 4 content-creating
  calls/write that is **~125 writes/hr for the entire org** on one shared
  installation. The architecture's "~6 calls, 15k/hr" framing (§7.1) cited the
  wrong ceiling — confirms outside-voice finding #4.
- **Mitigations:** per-space App installations (separate secondary buckets) for
  busy spaces; a fast-forward `PATCH` of the ref when `B == main` HEAD (skips the
  merge commit, one fewer content call, avoids bot merge-commit noise —
  outside-voice finding #11); coalesce where possible.

---

## Finding #1 (from the review) — CONFIRMED, and the fix is verified

The review warned that validating on an unprotected repo would test the wrong
config. It was right, and the real config bites:

- With **PR-required protection** on `main`, the App's direct `POST /merges` is
  **blocked: HTTP 409 "Changes must be made through a pull request."** So
  `auto_merge_clean` (which merges straight to `main`) is DOA against a
  PR-protected branch.
- **Fix (verified):** create a repository **ruleset** requiring PRs with the App
  as a **bypass actor** (`actor_type: "Integration", bypass_mode: "always"`).
  The App's direct `POST /merges` then returns **HTTP 201**. ✓

**Architecture change required:** the PR-required rule must be scoped to humans,
with the App/bot as a bypass actor. Provisioning must create this ruleset (not
just classic branch protection), and it requires a paid org.

---

## Surprises vs the architecture

| # | Surprise | Impact | Action |
|---|---|---|---|
| S1 | Free-tier private repos can't protect branches or use rulesets | Force-push protection + bypass-actor both unavailable | **Require a paid GitHub org** for space repos (ARCHITECTURE §7.1, provisioning) |
| S2 | PR-required protection blocks the App's `POST /merges` (409) | `auto_merge_clean` DOA without bypass | **App = ruleset bypass actor**; PR rule scoped to humans (confirms review #1) |
| S3 | `POST /merges` returns 204 when head already merged | Would corrupt `current_sha` if treated as a new SHA | Handle 204: re-resolve `main` SHA (confirms review #2) |
| S4 | Secondary content-creation cap (~500/hr/installation), not 15k/hr | ~125 writes/hr per org on one installation | Per-space installations / fast-forward path / coalesce (confirms review #4) |
| S5 | `author`/`committer` are arbitrary caller-set fields | Commit metadata is not trustworthy attribution | `audit_log` is authoritative (confirms review §7.2) |

## If it had been no-go
Fallback would have been the persistent-git-worker option (a container holding
working copies, shelling out to real `git`). Not needed: GitHub's server-side
3-way merge behaves correctly. That fallback stays the documented escape hatch if
the secondary rate limit ever becomes binding at scale.

## Teardown
Throwaway repo deleted. App private key deleted from disk. The `teio-context-spike`
GitHub App can be removed at github.com/settings/apps (harmless if left).
