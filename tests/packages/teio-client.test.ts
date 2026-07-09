import { describe, expect, it, vi } from 'vitest'
import { TeioContextClient } from '@/packages/teio-client'

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

describe('TeioContextClient — reads', () => {
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

describe('TeioContextClient — writes', () => {
  it('proposeUpdate POSTs snake_case fields to /context', async () => {
    const fetchImpl = fetchReturning(200, { status: 'merged', version: 'SHA' })
    const client = new TeioContextClient('https://x.test', 'tok', fetchImpl)

    const res = await client.proposeUpdate('s1', { path: 'context/a.md', content: 'hi', baseVersion: 'B0', baseBlob: 'BLOB0' })

    expect(res).toEqual({ status: 'merged', version: 'SHA' })
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(String(url)).toContain('/api/spaces/s1/context')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      path: 'context/a.md',
      content: 'hi',
      base_version: 'B0',
      base_blob: 'BLOB0',
    })
  })

  it('deletePath issues DELETE with path + base_version as query params', async () => {
    const fetchImpl = fetchReturning(200, { status: 'merged', version: 'SHA' })
    const client = new TeioContextClient('https://x.test', 'tok', fetchImpl)

    await client.deletePath('s1', { path: 'context/a.md', baseVersion: 'B0' })

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!
    expect((init as RequestInit).method).toBe('DELETE')
    expect(String(url)).toContain('path=context%2Fa.md')
    expect(String(url)).toContain('base_version=B0')
  })

  it('movePath POSTs from/to to /context/move', async () => {
    const fetchImpl = fetchReturning(202, { status: 'proposal', prUrl: 'https://gh/pr/1', proposalId: 'p1' })
    const client = new TeioContextClient('https://x.test', 'tok', fetchImpl)

    const res = await client.movePath('s1', { from: 'context/a.md', to: 'context/b.md' })

    expect(res).toEqual({ status: 'proposal', prUrl: 'https://gh/pr/1', proposalId: 'p1' })
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(String(url)).toContain('/api/spaces/s1/context/move')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ from: 'context/a.md', to: 'context/b.md', base_version: undefined })
  })
})
