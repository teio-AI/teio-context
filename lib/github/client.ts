import { GitHubError } from '../errors'
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
      const message =
        data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : text
      throw new GitHubError(res.status, message, `${method} ${path}`)
    }
    return { status: res.status, data: data as T }
  }
}
