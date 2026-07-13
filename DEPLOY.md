# Deploying teio-context

teio-context runs as its **own** standalone deployment — separate from TEIO.
It does not share TEIO's database, auth, or hosting. You provision four external
services (all have free/low tiers except the GitHub org), hand the values to the
app as env vars, apply the DB migrations, and deploy.

## The services, what each is for, and why it's needed

| Service | What it is | What teio-context uses it for | Why it's needed | Who sets it up |
|---------|-----------|-------------------------------|-----------------|----------------|
| **GitHub org (paid) + GitHub App** | A GitHub org on Team/Enterprise, plus an "App" (a bot identity) | The **canonical store**: one private repo per space holds the markdown; the App creates repos, commits, merges, and opens PRs as the bot. Webhooks notify us of changes. | Git *is* the content store, version history, and 3-way merge engine — there is no separate database of context. Private-repo **branch rulesets require a paid org** (free tier can't); the write path needs the App as a ruleset **bypass actor**. | You + Tarush |
| **Neon** (Postgres) | Serverless Postgres | The **control plane**: space registry, members/roles, machine tokens, connectors, sync cursors, audit log, and a derived search index (tsvector + snippet — never the full content). | Git can't answer "who may read space X" or "find docs about billing" quickly. Neon holds only pointers/policy/index; **no canonical context lives here**. | You (I'll wire + migrate) |
| **Clerk** | Hosted user auth | **Human login** for the admin/web surface: who can create spaces, add members, issue tokens. Resolves a request to a Clerk user id; role comes from Neon. | Engineers/owners need to sign in to manage spaces. Machines use tokens instead (no Clerk). A **separate Clerk app** from TEIO keeps the two isolated (its own login). | You (I'll wire) |
| **Vercel** | Hosting for Next.js | Runs the API + serverless functions, runs the **backfill cron** (`vercel.json`, every 10 min), holds the env vars/secrets. | Somewhere has to host it and run the scheduled reconciliation. Its `after()` primitive runs the webhook/import work off the request path. | You (I'll wire + deploy) |
| **1Password** | Secret vault (you already have it) | Stores the GitHub App private key, Clerk secret, DB URL, webhook/cron secrets — the source of truth you copy into Vercel env. | We deliberately store **no secrets in the app** (SPEC non-goal: no custom vault). | You |

You do the account/billing/browser steps (I have no credentials and these are
click-through flows). Then hand me the values in the env matrix below and I'll
wire, migrate, deploy, and smoke-test.

---

## Step 1 — Neon (do this first; unblocks everything DB)

1. Create a Neon account/project: <https://neon.tech> → New Project → name it
   `teio-context` (its own project, **not** TEIO's).
2. In the project, copy the **pooled** connection string (Connection Details →
   toggle **"Pooled connection"**). It looks like
   `postgresql://…@ep-xxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require`.
   The `-pooler` host matters — the app uses the serverless/pooled driver.
3. Hand me `DATABASE_URL`. I'll run `bun run migrate` to apply the schema
   (`db/migrations/*.sql`).

## Step 2 — Clerk (separate app from TEIO)

1. <https://clerk.com> → create a new **Application** named `teio-context`
   (do not reuse TEIO's). Pick email + whatever SSO you want for staff.
2. From **API Keys**, copy:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_…`)
   - `CLERK_SECRET_KEY` (`sk_…`)
3. Note your own Clerk **user id** (`user_…`, from the Clerk dashboard Users
   tab after you sign in once) — it goes in `STAFF_USER_IDS` so you can create
   spaces.
4. Hand me those three values.

## Step 3 — GitHub org + App (gated on the org; do when ready with Tarush)

1. On the **paid** org, go to Settings → Developer settings → **GitHub Apps** →
   New GitHub App.
   - **Webhook URL:** `https://<your-vercel-domain>/api/webhooks/github`
     (fill in after Step 4; you can edit it later).
   - **Webhook secret:** generate a long random string → this is
     `GITHUB_WEBHOOK_SECRET`.
   - **Repository permissions:** Contents = Read & write, Pull requests = Read &
     write, Administration = Read & write, Metadata = Read-only.
   - **Subscribe to events:** Push, Pull request.
   - **Where can this app be installed:** Only this account.
2. **Generate a private key** (downloads a `.pem`) → store in 1Password. This is
   `GITHUB_APP_PRIVATE_KEY` (paste contents; `\n`-escaped is fine).
3. Note the **App ID** → `GITHUB_APP_ID`.
4. **Install** the App on the org, all repos (or a repo pattern). This creates
   the installation the app mints tokens against.
5. **Ruleset bypass actor:** provisioning creates a PR-required ruleset on each
   space repo with the App as a bypass actor (verified in the Phase 0 spike). No
   manual step per repo — but the App must have Administration write (step 1) for
   this to work.
6. `GITHUB_ORG` = the org login. Hand me `GITHUB_APP_ID`,
   `GITHUB_APP_PRIVATE_KEY`, `GITHUB_ORG`, `GITHUB_WEBHOOK_SECRET`.

## Step 4 — Vercel

1. <https://vercel.com> → New Project → import `ravi-teio/teio-context` (or the
   org repo). Framework: Next.js (auto-detected).
2. Add all env vars from the matrix below (Project → Settings → Environment
   Variables). Generate `CRON_SECRET` as a long random string.
3. Deploy. The `vercel.json` cron (`/api/cron/backfill` every 10 min) registers
   automatically; Vercel sends `Authorization: Bearer $CRON_SECRET`.
4. Copy the deployment URL back into the GitHub App's Webhook URL (Step 3.1).

## Env matrix

| Var | From | Notes |
|-----|------|-------|
| `DATABASE_URL` | Neon | **pooled** (`-pooler`) connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk | `pk_…` |
| `CLERK_SECRET_KEY` | Clerk | `sk_…` |
| `STAFF_USER_IDS` | Clerk | your Clerk user id(s), comma-separated |
| `GITHUB_APP_ID` | GitHub App | numeric — **optional until the App exists** |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App | PEM contents — **optional until the App exists** |
| `GITHUB_ORG` | GitHub | the paid org login — **optional until the App exists** |
| `GITHUB_WEBHOOK_SECRET` | you | long random; matches the App's webhook secret |
| `CRON_SECRET` | you | long random; the backfill cron bearer |

**Staged deploy (before the GitHub org/App exist):** set only `DATABASE_URL` +
the Clerk vars + `STAFF_USER_IDS`, and **omit all `GITHUB_*`**. The app boots;
DB/Clerk routes (list spaces, search, proposals, members, tokens) work; the
GitHub-touching routes (create space, write, import) return a clean
`503 github_unconfigured` until you add the three `GITHUB_*` values and redeploy.
No placeholder values needed.

## Step 5 — Migrate + first space + smoke test

```bash
# once DATABASE_URL is set (locally or via a one-off against prod):
bun run migrate

# smoke-test the machine-token round trip against the deployment:
TEIO_CONTEXT_API_URL=https://<domain> TEIO_CONTEXT_TOKEN=<editor token> \
TEIO_CONTEXT_SPACE=<space id> bun run smoke
```

Bootstrapping the first space (needs a Clerk staff login): sign in to the
deployed app, then `POST /api/spaces {slug,name}`, then
`POST /api/spaces/:id/tokens {name, role:"editor"}` to mint the token the smoke
test (and MCP/TEIO) use.

## Order of operations

Neon (Step 1) and Clerk (Step 2) are independent — do them now; I can wire and
migrate immediately. Vercel (Step 4) needs those env values. The GitHub App
(Step 3) is gated on the paid org (you + Tarush) — everything else can be
staged and green before it lands; the first real space-provision + write round
trip is the moment the App must exist.
