import { GitHubError, RateLimitedError } from '../errors'
import type { FetchImpl } from './app-auth'

const API_BASE = 'https://api.github.com'

export interface GitHubResponse<T> {
  status: number
  data: T
}

/**
 * The seam every git operation goes through. ContextService and provisioning
 * depend on this interface, so tests inject a fake instead of hitting GitHub.
 */
export interface GitHubApi {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<GitHubResponse<T>>
}

/** Thin REST client bound to a single installation token. Throws GitHubError on non-2xx. */
export class GitHubClient implements GitHubApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<GitHubResponse<T>> {
    const res = await this.fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'teio-context',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!res.ok) {
      // Secondary/primary rate limit → surface as 429 with Retry-After
      // (ARCHITECTURE §7.1) rather than a generic 502. GitHub signals it as a
      // 403 (or 429) with a Retry-After header or x-ratelimit-remaining: 0.
      if (isRateLimit(res)) {
        const retryAfter = res.headers.get('retry-after')
        throw new RateLimitedError(retryAfter ? Number(retryAfter) : null, `${method} ${path}`)
      }
      const message =
        data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : text
      throw new GitHubError(res.status, message, `${method} ${path}`)
    }
    return { status: res.status, data: data as T }
  }
}

function isRateLimit(res: Response): boolean {
  if (res.status === 429) return true
  if (res.status === 403) {
    if (res.headers.get('retry-after')) return true
    if (res.headers.get('x-ratelimit-remaining') === '0') return true
  }
  return false
}
