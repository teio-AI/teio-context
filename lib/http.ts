import { AppError, RateLimitedError } from './errors'

/** Map any thrown value to a JSON Response with the right status code. */
export function toResponse(err: unknown): Response {
  if (err instanceof RateLimitedError) {
    const headers: Record<string, string> = {}
    if (err.retryAfterSeconds != null) headers['Retry-After'] = String(err.retryAfterSeconds)
    return Response.json({ error: err.code, message: err.message }, { status: err.httpStatus, headers })
  }
  if (err instanceof AppError) {
    return Response.json({ error: err.code, message: err.message }, { status: err.httpStatus })
  }
  // Never leak internals.
  return Response.json({ error: 'internal', message: 'unexpected error' }, { status: 500 })
}
