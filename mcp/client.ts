import type { DocumentRead, SearchHit, SpaceSummary } from '@/lib/context/types'

/**
 * Thin HTTP client over the teio-context REST API, bound to one per-space
 * machine token. This is the only thing mcp/server.ts talks to — it never
 * touches GitHub or Neon directly (ARCHITECTURE §4: adapters are thin
 * protocol translators with zero business logic).
 */
export class TeioContextClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
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
      throw new Error(`teio-context request failed (${res.status}): ${message}`)
    }
    return data as T
  }

  async listSpaces(): Promise<SpaceSummary[]> {
    const res = await this.get<{ spaces: SpaceSummary[] }>('/api/spaces')
    return res.spaces
  }

  async getVersion(spaceId: string): Promise<{ sha: string; updatedAt: string }> {
    return this.get(`/api/spaces/${encodeURIComponent(spaceId)}/version`)
  }

  async getDocument(spaceId: string, path: string): Promise<DocumentRead> {
    return this.get(`/api/spaces/${encodeURIComponent(spaceId)}/context?path=${encodeURIComponent(path)}`)
  }

  async search(spaceId: string, query: string): Promise<SearchHit[]> {
    const res = await this.get<{ results: SearchHit[] }>(
      `/api/spaces/${encodeURIComponent(spaceId)}/search?q=${encodeURIComponent(query)}`,
    )
    return res.results
  }
}
