import { describe, expect, it, vi } from 'vitest'
import { TeioContextClient } from '@/mcp/client'

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

describe('TeioContextClient', () => {
  it('listSpaces sends the bearer token and unwraps { spaces }', async () => {
    const fetchImpl = fetchReturning(200, { spaces: [{ id: 's1', slug: 'acme', name: 'Acme', role: 'reader' }] })
    const client = new TeioContextClient('https://x.test', 'tctx_acme_abc', fetchImpl)

    const spaces = await client.listSpaces()

    expect(spaces).toHaveLength(1)
    const [, init] = vi.mocked(fetchImpl).mock.calls[0]!
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tctx_acme_abc' })
  })

  it('getDocument encodes the path query param', async () => {
    const fetchImpl = fetchReturning(200, { path: 'context/a b.md', content: 'x', version: 'sha', blob: 'blobsha' })
    const client = new TeioContextClient('https://x.test', 'tok', fetchImpl)

    await client.getDocument('s1', 'context/a b.md')

    const [url] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(String(url)).toContain(encodeURIComponent('context/a b.md'))
  })

  it('throws with the server message on a non-2xx response', async () => {
    const fetchImpl = fetchReturning(404, { error: 'not_found', message: 'path not found: x' })
    const client = new TeioContextClient('https://x.test', 'tok', fetchImpl)
    await expect(client.getVersion('s1')).rejects.toThrow(/path not found: x/)
  })

  it('search unwraps { results }', async () => {
    const fetchImpl = fetchReturning(200, { results: [{ path: 'a.md', snippet: 's' }] })
    const client = new TeioContextClient('https://x.test', 'tok', fetchImpl)
    const results = await client.search('s1', 'billing')
    expect(results).toEqual([{ path: 'a.md', snippet: 's' }])
  })
})
