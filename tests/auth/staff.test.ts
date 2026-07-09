import { describe, expect, it } from 'vitest'
import { isStaff, parseStaffIds } from '@/lib/auth/staff'

describe('parseStaffIds', () => {
  it('parses a comma-separated list, trimming whitespace and dropping empties', () => {
    expect(parseStaffIds(' user_1, user_2 ,,user_3')).toEqual(new Set(['user_1', 'user_2', 'user_3']))
  })

  it('treats undefined/empty as no staff', () => {
    expect(parseStaffIds(undefined)).toEqual(new Set())
    expect(parseStaffIds('')).toEqual(new Set())
  })
})

describe('isStaff', () => {
  it('checks set membership', () => {
    const ids = parseStaffIds('user_1,user_2')
    expect(isStaff('user_1', ids)).toBe(true)
    expect(isStaff('user_9', ids)).toBe(false)
  })

  it('denies everyone when the allowlist is empty', () => {
    expect(isStaff('user_1', parseStaffIds(undefined))).toBe(false)
  })
})
