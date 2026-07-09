import { describe, expect, it } from 'vitest'
import { defaultPolicyForKind } from '@/lib/connectors'

describe('defaultPolicyForKind', () => {
  it('mcp defaults to proposal_only (external agents always PR)', () => {
    expect(defaultPolicyForKind('mcp')).toBe('proposal_only')
  })

  it('teio defaults to auto_merge_clean (trusted internal)', () => {
    expect(defaultPolicyForKind('teio')).toBe('auto_merge_clean')
  })

  it('customer has no v1 default — caller must specify explicitly', () => {
    expect(defaultPolicyForKind('customer')).toBeNull()
  })
})
