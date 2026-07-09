import { describe, expect, it, vi } from 'vitest'
import { GitHubError, RateLimitedError } from '@/lib/errors'
import { GitHubClient } from '@/lib/github/client'

function client(response: Response): GitHubClient {
  const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch
  return new GitHubClient('tok', fetchImpl)
}

describe('GitHubClient rate-limit mapping', () => {
  it('403 with x-ratelimit-remaining: 0 → RateLimitedError', async () => {
    const c = client(new Response('{"message":"rate limited"}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }))
    await expect(c.request('GET', '/x')).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('403 with Retry-After → RateLimitedError carrying the seconds', async () => {
    const c = client(new Response('{}', { status: 403, headers: { 'retry-after': '42' } }))
    await expect(c.request('GET', '/x')).rejects.toMatchObject({ retryAfterSeconds: 42 })
  })

  it('429 → RateLimitedError', async () => {
    const c = client(new Response('{}', { status: 429 }))
    await expect(c.request('GET', '/x')).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('a plain 404 → GitHubError, not RateLimitedError', async () => {
    const c = client(new Response('{"message":"Not Found"}', { status: 404 }))
    await expect(c.request('GET', '/x')).rejects.toBeInstanceOf(GitHubError)
  })

  it('a 403 with no rate-limit signal → GitHubError', async () => {
    const c = client(new Response('{"message":"forbidden"}', { status: 403 }))
    const err = await c.request('GET', '/x').catch((e) => e)
    expect(err).toBeInstanceOf(GitHubError)
    expect(err).not.toBeInstanceOf(RateLimitedError)
  })
})
