#!/usr/bin/env node
// The MCP adapter (ARCHITECTURE §4). Launched by Claude Code / Cursor / Codex
// with a per-space machine token — e.g. `bun run mcp/server.ts` with
// TEIO_CONTEXT_API_URL and TEIO_CONTEXT_TOKEN set. Read-only tools (Phase 2);
// propose_update/delete_path land in Phase 4 once the write path (Phase 3) exists.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { TeioContextClient } from './client'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required to launch the teio-context MCP server`)
  return value
}

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function errorResult(err: unknown) {
  return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true }
}

export function createServer(client: TeioContextClient): McpServer {
  const server = new McpServer({ name: 'teio-context', version: '0.1.0' })

  server.registerTool(
    'list_spaces',
    { description: 'List the context spaces this token can access.' },
    async () => {
      try {
        return textResult(await client.listSpaces())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'get_version',
    {
      description: 'Get the current version (commit SHA) of a space, for staleness checks.',
      inputSchema: { spaceId: z.string().describe('The space id (from list_spaces).') },
    },
    async ({ spaceId }) => {
      try {
        return textResult(await client.getVersion(spaceId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'get_document',
    {
      description: 'Read a document from a space. Returns content, version (commit SHA), and blob (for later writes).',
      inputSchema: {
        spaceId: z.string().describe('The space id (from list_spaces).'),
        path: z.string().describe('Path within the space, e.g. context/overview.md'),
      },
    },
    async ({ spaceId, path }) => {
      try {
        return textResult(await client.getDocument(spaceId, path))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'search',
    {
      description: 'Keyword search over a space’s documents. Returns path + snippet; use get_document to read a hit in full.',
      inputSchema: {
        spaceId: z.string().describe('The space id (from list_spaces).'),
        query: z.string().describe('Free-text search query.'),
      },
    },
    async ({ spaceId, query }) => {
      try {
        return textResult(await client.search(spaceId, query))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  return server
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('TEIO_CONTEXT_API_URL')
  const token = requireEnv('TEIO_CONTEXT_TOKEN')
  const client = new TeioContextClient(baseUrl, token)
  const server = createServer(client)
  await server.connect(new StdioServerTransport())
}

// Only auto-start when run directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
