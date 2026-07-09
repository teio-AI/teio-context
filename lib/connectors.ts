import type { WritePolicy } from './context/write-engine'

export type ConnectorKind = 'mcp' | 'teio' | 'customer'

/**
 * Per-kind default write-back policy at connector-registration time
 * (ARCHITECTURE §3.1, §8: "MCP → proposal_only (external agents always PR)",
 * "TEIO → auto_merge_clean (trusted internal)"). Returning null means there
 * is no spec'd default for that kind — the caller must specify one explicitly
 * rather than us silently assuming a policy for a kind that isn't v1 scope
 * (the customer connector is a v1.1 fast-follow, ARCHITECTURE §8).
 */
export function defaultPolicyForKind(kind: ConnectorKind): WritePolicy | null {
  switch (kind) {
    case 'mcp':
      return 'proposal_only'
    case 'teio':
      return 'auto_merge_clean'
    case 'customer':
      return null
  }
}
