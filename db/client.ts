import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { getEnv } from '@/lib/env'

/**
 * Pooled/serverless HTTP query function (ARCHITECTURE §6). One statement per
 * call, no long-lived socket — safe for function-per-request concurrency.
 *
 * Lazily initialized: env is read on first query, not at import, so `next build`
 * (which imports route modules) does not require DATABASE_URL to be set.
 */
let _sql: NeonQueryFunction<false, false> | null = null

function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) _sql = neon(getEnv().DATABASE_URL)
  return _sql
}

export const sql = ((strings: TemplateStringsArray, ...params: unknown[]) =>
  getSql()(strings, ...params)) as unknown as NeonQueryFunction<false, false>
