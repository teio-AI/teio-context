import { TeioContextClient } from '@/packages/teio-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Remote MCP endpoint (Streamable HTTP), so teio-context works as a network
 * connector in the Claude desktop app / claude.ai — not just the terminal's
 * local stdio server. Same 8 tools as mcp/server.ts; each tool call is proxied
 * through the existing REST API (loopback) with the caller's Bearer token, so
 * auth + write policy stay enforced server-side exactly as for every other
 * client. Stateless: no session store, one JSON-RPC message per POST.
 */

const SERVER_INFO = { name: 'teio-context', version: '0.1.0' }
const DEFAULT_PROTOCOL = '2024-11-05'

const S = (description: string) => ({ type: 'string' as const, description })

const TOOLS = [
  { name: 'list_spaces', description: 'List the context spaces this token can access.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_version', description: 'Get the current version (commit SHA) of a space, for staleness checks.', inputSchema: { type: 'object', properties: { spaceId: S('The space id (from list_spaces).') }, required: ['spaceId'], additionalProperties: false } },
  { name: 'get_document', description: 'Read a document from a space. Returns content, version (commit SHA), and blob (for later writes).', inputSchema: { type: 'object', properties: { spaceId: S('The space id (from list_spaces).'), path: S('Path within the space, e.g. context/overview.md') }, required: ['spaceId', 'path'], additionalProperties: false } },
  { name: 'search', description: 'Keyword search over a space’s documents. Returns path + snippet; use get_document to read a hit in full.', inputSchema: { type: 'object', properties: { spaceId: S('The space id (from list_spaces).'), query: S('Free-text search query.') }, required: ['spaceId', 'query'], additionalProperties: false } },
  { name: 'list_proposals', description: 'List open pull requests (proposals + conflicts) awaiting a human in a space.', inputSchema: { type: 'object', properties: { spaceId: S('The space id (from list_spaces).') }, required: ['spaceId'], additionalProperties: false } },
  { name: 'propose_update', description: 'Propose a change to a document (creates it if it does not exist). A clean, non-conflicting edit may auto-merge immediately depending on policy; otherwise it opens a pull request. Always pass baseVersion and baseBlob from a prior get_document call when editing an existing file.', inputSchema: { type: 'object', properties: { spaceId: S('The space id (from list_spaces).'), path: S('Path within the space, e.g. context/overview.md'), content: S('The full new content of the file (UTF-8 text, max 1 MiB).'), baseVersion: S('The version SHA from get_document, for optimistic concurrency.'), baseBlob: S('The blob SHA from get_document — enables the fast, single-call merge path.') }, required: ['spaceId', 'path', 'content'], additionalProperties: false } },
  { name: 'delete_path', description: 'Delete a document from a space. May open a pull request instead of deleting immediately, per policy.', inputSchema: { type: 'object', properties: { spaceId: S('The space id (from list_spaces).'), path: S('Path to delete.'), baseVersion: S('The version SHA from get_document/get_version, for optimistic concurrency.') }, required: ['spaceId', 'path'], additionalProperties: false } },
  { name: 'move_path', description: 'Rename or move a document within a space (a true rename — content is preserved, not recreated).', inputSchema: { type: 'object', properties: { spaceId: S('The space id (from list_spaces).'), from: S('Current path.'), to: S('New path.'), baseVersion: S('The version SHA from get_document/get_version, for optimistic concurrency.') }, required: ['spaceId', 'from', 'to'], additionalProperties: false } },
]

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

function toolResult(data: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}
function toolError(err: unknown) {
  return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true }
}

async function dispatchTool(client: TeioContextClient, name: string, a: Record<string, string>): Promise<unknown> {
  switch (name) {
    case 'list_spaces': return client.listSpaces()
    case 'get_version': return client.getVersion(a.spaceId!)
    case 'get_document': return client.getDocument(a.spaceId!, a.path!)
    case 'search': return client.search(a.spaceId!, a.query!)
    case 'list_proposals': return client.listProposals(a.spaceId!)
    case 'propose_update': return client.proposeUpdate(a.spaceId!, { path: a.path!, content: a.content!, baseVersion: a.baseVersion, baseBlob: a.baseBlob })
    case 'delete_path': return client.deletePath(a.spaceId!, { path: a.path!, baseVersion: a.baseVersion })
    case 'move_path': return client.movePath(a.spaceId!, { from: a.from!, to: a.to!, baseVersion: a.baseVersion })
    default: throw new Error(`unknown tool: ${name}`)
  }
}

interface RpcMessage { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

async function handle(msg: RpcMessage, token: string | null, origin: string): Promise<object | null> {
  const { id, method, params } = msg
  const isNotification = id === undefined || id === null
  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: { protocolVersion: (params?.protocolVersion as string) || DEFAULT_PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO } }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
    case 'tools/call': {
      const name = params?.name as string
      const args = (params?.arguments as Record<string, string>) || {}
      if (!token) return { jsonrpc: '2.0', id, result: toolError(new Error('missing Authorization: Bearer <token>')) }
      const client = new TeioContextClient(origin, token)
      try {
        return { jsonrpc: '2.0', id, result: toolResult(await dispatchTool(client, name, args)) }
      } catch (err) {
        return { jsonrpc: '2.0', id, result: toolError(err) }
      }
    }
    default:
      if (isNotification) return null
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } }
  }
}

function originOf(req: Request): string {
  const host = req.headers.get('host')
  if (host) return `${req.headers.get('x-forwarded-proto') || 'https'}://${host}`
  return new URL(req.url).origin
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(): Promise<Response> {
  return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'This MCP endpoint is POST-only (Streamable HTTP).' } }, 405)
}

export async function POST(req: Request): Promise<Response> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim() || null
  const origin = originOf(req)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 400)
  }

  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m) => handle(m as RpcMessage, token, origin)))).filter(Boolean)
    return responses.length ? json(responses) : new Response(null, { status: 202, headers: CORS })
  }

  const resp = await handle(body as RpcMessage, token, origin)
  if (!resp) return new Response(null, { status: 202, headers: CORS })
  return json(resp)
}
