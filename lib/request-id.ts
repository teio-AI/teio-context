import { randomUUID } from 'node:crypto'

/**
 * A correlation id for one request, recorded in audit_log so a log line or a
 * user report can be tied to the exact rows it produced. Prefers an
 * upstream-provided id (a proxy's `x-request-id`, or Vercel's `x-vercel-id`)
 * so the same id spans the platform's logs and ours; otherwise generates one.
 */
export function getRequestId(req: Request): string {
  return req.headers.get('x-request-id') ?? req.headers.get('x-vercel-id') ?? randomUUID()
}
