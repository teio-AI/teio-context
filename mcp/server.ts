#!/usr/bin/env node
// The MCP adapter (ARCHITECTURE §4). Launched by Claude Code / Cursor / Codex
// with a per-space machine token — e.g. `bun run mcp/server.ts` with
// TEIO_CONTEXT_API_URL and TEIO_CONTEXT_TOKEN set. Read + write tools; the
// server never talks to GitHub/Neon directly, only this REST API — the
// write-back policy (proposal_only by default for MCP connectors) is
// enforced server-side from the token's connector binding, not by anything
// this adapter asserts (ARCHITECTURE §3.1).
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

  server.registerTool(
    'list_proposals',
    {
      description: 'List open pull requests (proposals + conflicts) awaiting a human in a space.',
      inputSchema: { spaceId: z.string().describe('The space id (from list_spaces).') },
    },
    async ({ spaceId }) => {
      try {
        return textResult(await client.listProposals(spaceId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'propose_update',
    {
      description:
        'Propose a change to a document (creates it if it does not exist). A clean, non-conflicting edit may auto-merge ' +
        'immediately depending on the space/connector policy; otherwise it opens a pull request for a human to review. ' +
        'Always pass baseVersion and baseBlob from a prior get_document call when editing an existing file.',
      inputSchema: {
        spaceId: z.string().describe('The space id (from list_spaces).'),
        path: z.string().describe('Path within the space, e.g. context/overview.md'),
        content: z.string().describe('The full new content of the file (UTF-8 text, max 1 MiB).'),
        baseVersion: z.string().optional().describe('The version SHA from get_document, for optimistic concurrency.'),
        baseBlob: z.string().optional().describe('The blob SHA from get_document — enables the fast, single-call merge path.'),
      },
    },
    async ({ spaceId, path, content, baseVersion, baseBlob }) => {
      try {
        return textResult(await client.proposeUpdate(spaceId, { path, content, baseVersion, baseBlob }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'delete_path',
    {
      description: 'Delete a document from a space. May open a pull request instead of deleting immediately, per policy.',
      inputSchema: {
        spaceId: z.string().describe('The space id (from list_spaces).'),
        path: z.string().describe('Path to delete.'),
        baseVersion: z.string().optional().describe('The version SHA from get_document/get_version, for optimistic concurrency.'),
      },
    },
    async ({ spaceId, path, baseVersion }) => {
      try {
        return textResult(await client.deletePath(spaceId, { path, baseVersion }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'move_path',
    {
      description: 'Rename or move a document within a space (a true rename — content is preserved, not recreated).',
      inputSchema: {
        spaceId: z.string().describe('The space id (from list_spaces).'),
        from: z.string().describe('Current path.'),
        to: z.string().describe('New path.'),
        baseVersion: z.string().optional().describe('The version SHA from get_document/get_version, for optimistic concurrency.'),
      },
    },
    async ({ spaceId, from, to, baseVersion }) => {
      try {
        return textResult(await client.movePath(spaceId, { from, to, baseVersion }))
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
