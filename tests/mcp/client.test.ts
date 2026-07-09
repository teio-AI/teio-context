import { describe, expect, it } from 'vitest'
import { TeioContextClient as ReExported } from '@/mcp/client'
import { TeioContextClient as Canonical } from '@/packages/teio-client'

// mcp/client.ts is a re-export shim — the full behavior suite lives in
// tests/packages/teio-client.test.ts (the canonical, self-contained client
// both the MCP adapter and TEIO's own codebase consume).
describe('mcp/client re-export', () => {
  it('re-exports the exact same class as packages/teio-client', () => {
    expect(ReExported).toBe(Canonical)
  })
})
