import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ ping: vi.fn() }))
vi.mock('@/db', () => ({ ping: h.ping }))

import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  it('DB reachable → 200 { ok: true, db: up }', async () => {
    h.ping.mockResolvedValue(undefined)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, db: 'up' })
  })

  it('DB unreachable → 503 { ok: false, db: down }', async () => {
    h.ping.mockRejectedValue(new Error('connection refused'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, db: 'down' })
  })
})
