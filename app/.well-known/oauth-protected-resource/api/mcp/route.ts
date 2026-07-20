// OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP resource at
// /api/mcp. Tells MCP clients which authorization server protects this resource
// (Clerk) and which scopes it understands. Path mirrors the resource path
// (/api/mcp); withMcpAuth's resourceMetadataPath points here.
import { protectedResourceHandlerClerk, metadataCorsOptionsRequestHandler } from '@clerk/mcp-tools/next'

export const runtime = 'nodejs'

const handler = protectedResourceHandlerClerk({ scopes_supported: ['profile', 'email'] })
const corsHandler = metadataCorsOptionsRequestHandler()

export { handler as GET, corsHandler as OPTIONS }
