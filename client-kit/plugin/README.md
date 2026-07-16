# teio-context plugin

One-step Claude Code plugin: bundles the `/teio:start` and
`/teio:complete` commands **and** the teio-context MCP server, and
prompts for a personal token on install (stored in the OS keychain).

## Install (end users)

From the terminal (works everywhere):
```
claude plugin marketplace add teio-AI/teio-context
claude plugin install teio@teio-ai --config api_token=tctx_YOUR_TOKEN
```
Then restart Claude Code. Commands: `/teio:start`, `/teio:complete`.

In-app (if `/plugin` is available): `/plugin marketplace add teio-AI/teio-context`
→ `/plugin install teio@teio-ai` → `/plugin configure teio@teio-ai` (prompts for
the token). Change the token later: `claude plugin uninstall teio@teio-ai` then
reinstall with a new `--config api_token=…`.

## Layout
```
.claude-plugin/plugin.json   ← manifest: userConfig (token prompt) + mcpServers
commands/                    ← the slash commands
dist/server.js               ← bundled MCP server (generated; runs via node)
```

## Self-contained — no npm
`mcpServers` runs `node ${CLAUDE_PLUGIN_ROOT}/dist/server.js`, so installing the
plugin (a git-based marketplace) delivers the server too. Only **Node.js** is
required on the user's machine — no npm package, no publish step.

## Updating the bundled server
`dist/server.js` is **generated** from `mcp/server.ts`. After changing server
code, rebuild and commit it:
```
bun run build:plugin
```
