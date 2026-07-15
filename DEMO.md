# teio-context — end-to-end demo

A ~10-minute, fully-live walkthrough on `https://teio-context.vercel.app`. Current
model: Owner/Admin/Editor/Reader, email invites, per-project tokens (auto-merge by
default, opt-in review), git-backed two-way sync, and an in-UI context browser.

## The one-liner
> Canonical context about each client lives as markdown in **one git repo per
> project**. teio-context serves it two ways — out to consumers, back in from them
> — over git + REST + MCP, with roles, email invites, and conflict-safe writes.

## Prereqs (once)
- **You are the Owner:** `STAFF_USER_IDS` on Vercel = your Clerk id
  `user_3GXGezT1hnI8VggUPnrMyfkQY5M` (ravi@teio.ai). Owners create projects and
  see/administer all of them.
- Clean slate: no projects/users except you.

---

## Part 1 — Create a project (UI, as Owner)
1. Sign in at `/` as **ravi@teio.ai** → lands on the **dashboard**.
2. **New project**: name `Acme Corp`, slug `acme` → **Create**. This provisions a
   real private git repo + branch protection, and you become its **Admin**.
3. Open **Acme Corp** → **Overview** (version, docs, writes/7d, open proposals).

## Part 2 — Put context in (agent via MCP) and see it in the UI
4. **Tokens** tab → **Generate** a token named `my-agent` (it inherits your role).
   Copy it once.
5. Wire it to Claude (MCP) — user-level, nothing added to any code repo:
   ```bash
   claude mcp add --scope user teio-context \
     --env TEIO_CONTEXT_API_URL=https://teio-context.vercel.app \
     --env TEIO_CONTEXT_TOKEN=<the token> \
     -- npx -y teio-context-mcp          # or: node <path>/packages/teio-context-mcp/dist/server.js
   ```
6. In Claude: *"list my context spaces, then propose_update `context/overview.md`
   with 'Acme is a B2B logistics client, billed net-15.'"* — it writes via the API.
7. Back in the dashboard → **Context** tab → the doc appears; click it to **read the
   markdown**. (This is context captured by an agent, visible to everyone.)
   *(No MCP handy? Skip 5–6 and write via the browser console — see Appendix.)*

## Part 3 — Invite a teammate by email
8. **Members** tab → invite `teammate@company.com` as **editor** → they get a Clerk
   email. **Accept** → sign up (ticket creates the account) → they land on the
   dashboard and are auto-added as a member (reconciled by verified email).
9. Show roles: Owner (you, non-removable), Admin, Editor, Reader; last-admin and
   Owner can't be removed.

## Part 4 — Governed two-way writes (the core)
10. Generate a second token with **"require review"** on (an untrusted agent).
11. Have it `propose_update` a doc → the write **opens a PR** instead of merging.
    Show the PR on GitHub (open the repo from Overview) and the **History** tab.
12. A normal token's write **auto-merges** to `main`. Two writers editing the same
    line → one merges, the other becomes a **conflict PR** (no lost updates).

## Part 5 — Search
13. Any member/agent can **search** the project's context (FTS with highlighted
    snippets) via the API/MCP.

## Close
"Multi-project, email-invited people + scoped agents, context you can read in the
UI or over MCP, governed two-way writes that never clobber — over git, REST, and
MCP."

---

## Appendix — write context from the browser (no MCP needed)
On any teio-context.vercel.app page (signed in), DevTools console:
```js
const S = '<space id from the URL>'
await fetch(`/api/spaces/${S}/context`, { method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ path:'context/overview.md', content:'# Acme\n\nBilled net-15.\n' }) }).then(r=>r.json())
```
Then open the **Context** tab.

## Appendix — scripted multi-agent demo (optional)
`scripts/demo.ts` provisions two projects and drives the live API as several
tokens (auto-merge vs review→PR, concurrent conflict, search):
```bash
GITHUB_APP_PRIVATE_KEY="$(cat /Users/ravi/.config/teio-context/teio-context-spike.2026-07-14.private-key.pem)" \
  bun scripts/demo.ts        # prints repo + PR URLs; `... cleanup <slug> <slug>` to remove
```
