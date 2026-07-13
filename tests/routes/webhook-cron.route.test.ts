import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Guard coverage for the two infra endpoints (auth'd by shared secret, not
// Clerk/token). We test the synchronous guard/ack logic only — `after()` is
// mocked to a no-op so the background reindex/reconcile never runs here (its
// pieces are covered by reindex + db integration tests).
const h = vi.hoisted(() => ({ getEnv: vi.fn(), recordDelivery: vi.fn(), after: vi.fn() }))
vi.mock('next/server', () => ({ after: h.after }))
vi.mock('@/lib/env', () => ({ getEnv: h.getEnv, getGitHubConfig: vi.fn() }))
// Keep real db exports (wiring reads several at module load); nothing connects
// at import (the neon client is lazy). Only recordDelivery is overridden, and
// after() is a no-op so no other db function actually runs in these guard tests.
vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  recordDelivery: h.recordDelivery,
}))

import { POST as webhookPOST } from '@/app/api/webhooks/github/route'
import { GET as cronGET } from '@/app/api/cron/backfill/route'

const SECRET = 'webhook-secret'
const CRON = 'cron-secret'

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

function webhookReq(opts: { body: string; sig?: string | null; event?: string; delivery?: string | null }): Request {
  const headers: Record<string, string> = {}
  if (opts.sig !== null) headers['x-hub-signature-256'] = opts.sig ?? sign(opts.body)
  headers['x-github-event'] = opts.event ?? 'push'
  if (opts.delivery !== null) headers['x-github-delivery'] = opts.delivery ?? 'dlv-1'
  return new Request('https://x.test/api/webhooks/github', { method: 'POST', headers, body: opts.body })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getEnv.mockReturnValue({ GITHUB_WEBHOOK_SECRET: SECRET, CRON_SECRET: CRON })
  h.recordDelivery.mockResolvedValue(true)
})

describe('POST /api/webhooks/github', () => {
  const body = JSON.stringify({ ref: 'refs/heads/main', after: 'sha', repository: { name: 'r', owner: { login: 'o' } } })

  it('no webhook secret configured → 503', async () => {
    h.getEnv.mockReturnValue({})
    expect((await webhookPOST(webhookReq({ body }))).status).toBe(503)
  })

  it('bad signature → 401', async () => {
    const res = await webhookPOST(webhookReq({ body, sig: 'sha256=deadbeef' }))
    expect(res.status).toBe(401)
    expect(h.recordDelivery).not.toHaveBeenCalled()
  })

  it('valid signature but missing delivery id → 400', async () => {
    expect((await webhookPOST(webhookReq({ body, delivery: null }))).status).toBe(400)
  })

  it('duplicate delivery (already recorded) → 200 ignored, no processing', async () => {
    h.recordDelivery.mockResolvedValue(false)
    const res = await webhookPOST(webhookReq({ body }))
    expect(res.status).toBe(200)
    expect(h.after).not.toHaveBeenCalled()
  })

  it('valid new push → 202 and schedules background work', async () => {
    const res = await webhookPOST(webhookReq({ body }))
    expect(res.status).toBe(202)
    expect(h.after).toHaveBeenCalledTimes(1)
  })

  it('unknown event is acked (202) but schedules nothing', async () => {
    const res = await webhookPOST(webhookReq({ body: '{}', event: 'star' }))
    expect(res.status).toBe(202)
    expect(h.after).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/backfill', () => {
  function cronReq(bearer?: string): Request {
    const headers: Record<string, string> = {}
    if (bearer) headers.authorization = `Bearer ${bearer}`
    return new Request('https://x.test/api/cron/backfill', { headers })
  }

  it('no CRON_SECRET configured → 503', async () => {
    h.getEnv.mockReturnValue({})
    expect((await cronGET(cronReq(CRON))).status).toBe(503)
  })

  it('wrong bearer → 401', async () => {
    const res = await cronGET(cronReq('nope'))
    expect(res.status).toBe(401)
    expect(h.after).not.toHaveBeenCalled()
  })

  it('correct bearer → 202 and schedules the backfill', async () => {
    const res = await cronGET(cronReq(CRON))
    expect(res.status).toBe(202)
    expect(h.after).toHaveBeenCalledTimes(1)
  })
})
