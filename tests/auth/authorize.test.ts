import { describe, expect, it } from 'vitest'
import { assertSafePath, authorizeSpace, hasRole, higherRole, requiredRoleForPath } from '@/lib/auth/authorize'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import type { Role } from '@/lib/context/types'

describe('assertSafePath', () => {
  it('accepts normal relative paths', () => {
    expect(() => assertSafePath('context/a.md')).not.toThrow()
    expect(() => assertSafePath('space.yaml')).not.toThrow()
    expect(() => assertSafePath('context/x/y.md')).not.toThrow()
  })

  it('rejects traversal, absolute, empty, and dot segments', () => {
    for (const bad of ['', '/etc/passwd', 'context/../secret', '..', 'context/./a.md', 'context//a.md', ' context/a.md ']) {
      expect(() => assertSafePath(bad)).toThrow(ValidationError)
    }
  })
})

describe('hasRole', () => {
  it('ranks reader < editor < owner', () => {
    expect(hasRole('admin', 'editor')).toBe(true)
    expect(hasRole('editor', 'editor')).toBe(true)
    expect(hasRole('reader', 'editor')).toBe(false)
    expect(hasRole('editor', 'admin')).toBe(false)
  })
})

describe('higherRole', () => {
  it('returns the stricter of two roles', () => {
    expect(higherRole('editor', 'admin')).toBe('admin')
    expect(higherRole('admin', 'editor')).toBe('admin')
    expect(higherRole('reader', 'editor')).toBe('editor')
    expect(higherRole('editor', 'editor')).toBe('editor')
  })
})

describe('requiredRoleForPath', () => {
  it('space.yaml requires owner; context/** requires editor; else invalid', () => {
    expect(requiredRoleForPath('space.yaml')).toBe('admin')
    expect(requiredRoleForPath('context/projects/x.md')).toBe('editor')
    expect(() => requiredRoleForPath('secrets.md')).toThrow(ValidationError)
  })

  it('rejects a traversal path that would escape the context/ sandbox', () => {
    expect(() => requiredRoleForPath('context/../secrets.md')).toThrow(ValidationError)
  })
})

describe('authorizeSpace', () => {
  const lookupReturning = (role: Role | null) => async () => role

  it('allows when the role is sufficient', async () => {
    await expect(authorizeSpace(lookupReturning('admin'), { type: 'user', id: 'u1' }, 's1', 'editor')).resolves.toBe('admin')
  })

  it('denies non-members', async () => {
    await expect(authorizeSpace(lookupReturning(null), { type: 'user', id: 'u1' }, 's1', 'reader')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('denies insufficient role', async () => {
    await expect(authorizeSpace(lookupReturning('reader'), { type: 'token', id: 't1' }, 's1', 'editor')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})
