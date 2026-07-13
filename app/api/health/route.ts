import * as db from '@/db'

export const runtime = 'nodejs'

/**
 * Readiness probe. Pings the DB so a load balancer / uptime check sees 503 when
 * Neon is unreachable, not a false-green 200. (Phase 1 returned static ok.)
 */
export async function GET(): Promise<Response> {
  const base = { service: 'teio-context', ts: new Date().toISOString() }
  try {
    await db.ping()
    return Response.json({ ...base, ok: true, db: 'up' })
  } catch {
    return Response.json({ ...base, ok: false, db: 'down' }, { status: 503 })
  }
}
