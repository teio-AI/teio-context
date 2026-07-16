# teio-context-mcp

MCP server for **teio-context** — lets an AI agent (Claude, Cursor, …) read and
write a project's shared context over the teio-context API. Self-contained: the
published bundle has no runtime dependencies.

## Use (after publish)

```bash
claude mcp add --scope user teio-context \
  --env TEIO_CONTEXT_API_URL=https://teio-context.vercel.app \
  --env TEIO_CONTEXT_TOKEN=tctx_YOUR_PERSONAL_TOKEN \
  -- npx -y teio-context-mcp
```

- `TEIO_CONTEXT_TOKEN` — your **personal access token** (Settings → Personal
  access token); acts with your role on every project. A per-project **service
  token** (a project's Tokens tab, admin-only) works too and can carry "require
  review" to make its writes open PRs.
- Tools: `list_spaces`, `get_version`, `get_document`, `search`,
  `propose_update`, `move_path`, `delete_path`, `list_proposals`.

## Build / publish

```bash
bun run build          # bundles ../../mcp/server.ts → dist/server.js (with shebang)
npm publish            # publishes teio-context-mcp (requires npm login) — runs build via prepublishOnly
```

Until it's published to npm, run it from this checkout instead:

```bash
bun run build
claude mcp add --scope user teio-context \
  --env TEIO_CONTEXT_API_URL=… --env TEIO_CONTEXT_TOKEN=… \
  -- node /ABSOLUTE/PATH/TO/packages/teio-context-mcp/dist/server.js
```
