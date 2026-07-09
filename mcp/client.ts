// The MCP adapter reuses the same self-contained client TEIO consumes
// (packages/teio-client) — one implementation, not two. Re-exported here so
// mcp/server.ts's import path stays local to the adapter it belongs to.
export { TeioContextClient } from '../packages/teio-client'
