// OAuth 2.0 Authorization Server Metadata (RFC 8414) — points MCP clients at
// Clerk as the authorization server for the teiō context connector. Clerk
// derives the metadata from this instance's configured domain.
import { authServerMetadataHandlerClerk, metadataCorsOptionsRequestHandler } from '@clerk/mcp-tools/next'

export const runtime = 'nodejs'

const handler = authServerMetadataHandlerClerk()
const corsHandler = metadataCorsOptionsRequestHandler()

export { handler as GET, corsHandler as OPTIONS }
