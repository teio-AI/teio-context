# teio-context — onboarding

**Shared context for your projects.** teio-context keeps a living, markdown
record of what a project *is* — its architecture, conventions, and the decisions
that aren't obvious from the code — so every teammate (and every AI agent, on any
model) starts a session already knowing the project. Context lives in a private
git repo per project; you read and update it from your own Claude Code session
with two commands.

Nothing you install touches your code repo. The commands only **read** your
working directory; every write goes to the separate teio-context repo.

---

## 1. Get access

1. An admin invites you to a project by email. You'll get an invite; accept it and
   sign in at **[teio-context.vercel.app](https://teio-context.vercel.app)**.
2. On the dashboard you'll see the projects you're a member of.

## 2. Generate your personal token

Open **Settings → Personal access token** and generate one. This single token
works across **all** your projects and acts with **your role** on each — no
per-project token swapping. Treat it like an API key; you can revoke it anytime.

## 3. Install (once)

Install the plugin — it bundles both commands **and** the MCP server
(self-contained — no npm, just needs Node.js) and prompts you for your token
(stored in your OS keychain, not in any file). In Claude Code:

```
/plugin marketplace add teio-AI/teio-context
/plugin install teio@teio-ai
```

You'll be prompted for your **personal token** from step 2. That's it — your
commands are `/teio:start` and `/teio:complete`.

*(No `/plugin` command? Update Claude Code, or run the same two commands from your
terminal as `claude plugin marketplace add …` / `claude plugin install …`.)*

---

## Daily use

### `/teio:start <project-slug>`

Run it from inside the code repo you're working on. It:

- **Loads** the project's shared context into your session (a briefing: what the
  project is, which repos it spans, what the last session did).
- On the **first ever run** for a project, it **bootstraps** the context from the
  repo you're in.
- When you open a **different code repo of the same project**, it **imports** that
  repo into the project (see *Multiple repos* below).

### `/teio:complete "<short summary>"`

Run it when you're done. It persists what the session learned — updates the
affected docs and logs a dated handoff — so the next person (or the next model)
picks up exactly where you left off. By default writes auto-merge; a review-gated
token opens a PR instead.

---

## How context is stored

One **project = one private git context repo** (owned by the teio org). Inside it,
a **shared** layer describes the whole system, and **each code repo** gets its own
subtree:

```
context/
  overview.md            shared — what the whole project/client is
  architecture.md        shared — how the repos fit together + a Repositories index
  glossary.md            shared — domain terms
  conventions.md         shared — standing decisions (revenue source of truth, etc.)
  handoffs/
    log.md               thin newest-first index (one line per session)
    2026-07-16.md        full handoff entries, one file per day
  repos/
    acme-api/            one code repo…
      overview.md
      components.md
      imported/…         its existing docs, copied verbatim
    acme-web/            …another code repo of the same project
      overview.md
      components.md
      imported/…
```

Because it's plain git: full history and audit on every change, conflicts resolve
the normal git way, and you can browse it right here in the app (**Context** tab)
or in GitHub.

## Multiple repos in one project

A client with several code repos still has **one** context repo. The first repo
you `/teio:start` bootstraps the shared layer plus its own `repos/<repo>/` subtree.
When a teammate opens a **second** repo of the same project and runs
`/teio:start <slug>`, teio-context notices that repo isn't represented yet,
**imports** it into `context/repos/<second-repo>/`, and registers it in the shared
`architecture.md` Repositories index. From then on, everyone's briefing shows the
whole system — all repos, side by side.

*(Non-code context — meeting notes, recordings, per-person context — will slot in
as sibling folders like `context/meetings/` using the same shape.)*

## Roles

| Role | Can do |
|------|--------|
| **Reader** | Read context |
| **Editor** | Read + write context |
| **Admin** | Editor + manage members, tokens, settings |
| **Owner** | Global: creates projects, admin on every project |

## FAQ

**Does this modify my code repo?** No. The commands only read your working
directory and cannot create, edit, or commit anything in it. The install is
user-level, so nothing lands in the repo either.

**Does my code live in teio-context?** No — only the *context* (markdown
summaries and decisions) lives in the context repo. Your source stays where it is.

**GitHub, Azure Repos, or a plain folder?** All fine — Claude reads your local
working copy; where your code is hosted doesn't matter.

**I work on several projects.** One personal token covers all of them.
`/teio:start` lists what you can see; just name the project: `/teio:start acme`.
