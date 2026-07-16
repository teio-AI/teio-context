# teio-context plugin

One-step Claude Code plugin: ships the `/teio:start` and `/teio:complete`
commands and points at the **hosted teio-context MCP server** over HTTPS, so it
works in the **terminal and the desktop app** — nothing runs locally. It prompts
for a personal token on install (stored in the OS keychain).

## Install (end users)

From the terminal:
```
claude plugin marketplace add teio-AI/teio-context
claude plugin install teio@teio-ai --config api_token=tctx_YOUR_TOKEN
```
**Then fully quit and reopen Claude Code.** Commands: `/teio:start`, `/teio:complete`.

In-app (if `/plugin` is available): `/plugin marketplace add teio-AI/teio-context`
→ `/plugin install teio@teio-ai` → `/plugin configure teio@teio-ai` (prompts for
the token). Change the token later: `claude plugin uninstall teio@teio-ai` then
reinstall with a new `--config api_token=…`.

## Layout
```
.claude-plugin/plugin.json   ← manifest: userConfig (token prompt) + mcpServers (remote HTTP)
commands/                    ← the slash commands
```

## Remote MCP — nothing runs locally
`mcpServers` points at `https://teio-context.vercel.app/api/mcp` (Streamable HTTP)
with the token sent as a `Bearer` header. No local process, no Node.js, no PATH
issues — which is why it works in the desktop app as well as the terminal. The
server implementation lives in the main app at `app/api/mcp/route.ts` (a
self-contained stdio build is also published as `packages/teio-context-mcp` for
anyone who prefers a local `npx` server).
