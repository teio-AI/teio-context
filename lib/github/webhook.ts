import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify a GitHub webhook's X-Hub-Signature-256 (HMAC-SHA256 of the raw body
 * with the shared secret). Constant-time compare. Must run on the RAW request
 * bytes — re-serializing the parsed JSON would change the signature.
 */
export function verifyWebhookSignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signatureHeader, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
