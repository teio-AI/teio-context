import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyWebhookSignature } from '@/lib/github/webhook'

const SECRET = 'shhh'
function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

describe('verifyWebhookSignature', () => {
  it('accepts a correct signature over the raw body', () => {
    const body = '{"ref":"refs/heads/main"}'
    expect(verifyWebhookSignature(SECRET, body, sign(body))).toBe(true)
  })

  it('rejects a tampered body', () => {
    const body = '{"ref":"refs/heads/main"}'
    const sig = sign(body)
    expect(verifyWebhookSignature(SECRET, body + ' ', sig)).toBe(false)
  })

  it('rejects a wrong secret', () => {
    const body = '{"a":1}'
    const wrong = 'sha256=' + createHmac('sha256', 'nope').update(body).digest('hex')
    expect(verifyWebhookSignature(SECRET, body, wrong)).toBe(false)
  })

  it('rejects a missing or malformed signature header', () => {
    expect(verifyWebhookSignature(SECRET, '{}', null)).toBe(false)
    expect(verifyWebhookSignature(SECRET, '{}', 'garbage')).toBe(false)
  })
})
