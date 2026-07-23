# Open-sourcing teio-context — plan & decisions

*A short brief for deciding how and when we open-source teio-context.*

## TL;DR
- teio-context is **built, deployed, and working** — Claude Code plugin (`/teio:start`, `/teio:complete`) backed by a hosted MCP endpoint. Works in the terminal today; desktop app just needs a one-time connector approval.
- Open-sourcing is **mostly straightforward**. There's exactly **one real decision: auth** — we use Clerk (a proprietary SaaS) for human sign-in.
- **Recommendation:** ship an OSS release with **pluggable auth** (Clerk stays as one option, GitHub-OAuth becomes the open default). If we want it public *fast*, ship with Clerk-documented-as-swappable first and add the open adapter right after.

## What it is (one line)
A shared-context layer: each project's context lives as markdown in a private git repo; Neon Postgres is the control plane; it's served over git + a REST API + a remote MCP endpoint; developers use it via a Claude Code plugin.

## Why open-source (the upside)
- Credibility + a strong newsletter story ("we contribute back to the community").
- Adoption + contributions; a natural top-of-funnel for the platform.
- The design is genuinely reusable — shared context is a broadly useful primitive.

## What open-sourcing requires
1. **Auth** — soften/remove the hard dependency on Clerk *(the one real decision — see below)*.
2. **Configurable project-creation policy** — today creation is gated to our owner allowlist (`STAFF_USER_IDS` / `STAFF_EMAILS`); a self-hosted instance owner should decide the policy.
3. **Standard OSS files** — `LICENSE`, top-level `README`, `.env.example`, `CONTRIBUTING`, `SECURITY.md`.
4. **Self-host docs** — how to run it on your own infra (below).
5. **Scrub + go public** — remove internal/throwaway files, confirm no secrets committed (`.env.local` is already gitignored), then flip the repo public.
6. **A name** (see Naming).

## The one real decision: auth
Today Clerk handles human sign-in (Google + email invites). Open-sourcing doesn't *forbid* Clerk — self-hosters could bring their own keys — but requiring a proprietary SaaS is friction and undercuts the "no proprietary vendor" story.

| Option | What it means | Effort | Trade-off |
|---|---|---|---|
| **A. Keep Clerk, documented as swappable** | Ship as-is; self-hosters add their own (free) Clerk keys | ~1–2 days | Fastest to public; but self-hosting still needs a Clerk account |
| **B. Pluggable auth + open default** *(recommended)* | Abstract the auth layer; Clerk becomes one adapter, **GitHub-OAuth (Auth.js)** the open default | ~1–2 weeks | True "no proprietary vendor"; a real but contained refactor |
| **C. Token / single-user mode** | Minimal: API-token auth only, skip the web sign-in for solo self-hosters | ~2–3 days | Simplest to run alone; weaker for teams |

**Recommendation:** **B** for the public story, and it composes with **C** as a bundled "solo mode." If speed matters more than the purity, **A** gets us public this week and **B** follows.

## Other dependencies — all fine for OSS
- **Neon** → just **Postgres**; any Postgres works (connection string). Not lock-in.
- **Vercel** → standard **Next.js**; deployable on any Node host / Docker.
- **GitHub** → core to the design (git-as-store). Free-tier works via a flag (`GITHUB_ALLOW_UNPROTECTED`); a paid org gives protected private repos.

## Proposed plan (phased)
- **Phase 1 — runnable by anyone (~1–2 days):** LICENSE (MIT), README, `.env.example`, CONTRIBUTING, self-host docs, scrub internal files, pick a name.
- **Phase 2 — auth (per the decision above):** A (~days) or B (~1–2 weeks) + optional C.
- **Phase 3 — launch:** flip the repo public → the plugin marketplace becomes frictionless → newsletter announcement.

## Naming
The plugin is currently "teio" — for a public OSS project we should pick a distinct, **trademark-safe** name (avoid "Pikachu"/"Apache" — those are protected). We'll shortlist and check npm/GitHub/trademark availability before committing.

## What we need from you (Tarush)
1. **Auth strategy:** A (fast), **B (recommended)**, or B+C.
2. **License:** MIT ok? (most permissive, best for adoption.)
3. **Name:** your call / veto on the shortlist.
4. **Green-light** to make the repo public once scrubbed.

*Everything except the auth decision is low-risk and ready to start immediately.*
