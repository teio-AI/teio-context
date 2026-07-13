/**
 * The TEIO / MCP adapter client (ARCHITECTURE §4). A thin, self-contained
 * REST wrapper — zero business logic, never touches GitHub or Neon directly.
 *
 * Deliberately self-contained: this package is meant to be consumable
 * outside this repo (TEIO is a separate application), so it has no internal
 * `@/...` aliased imports. Types below restate (not import) the server's
 * response shapes — normal for a client SDK shipped independently of its
 * server's internals.
 */

export type Role = 'owner' | 'editor' | 'reader'

export interface SpaceSummary {
  id: string
  slug: string
  name: string
  role: Role
}

export interface DocumentRead {
  path: string
  content: string
  /** commit SHA of the branch HEAD at read time (the version handle) */
  version: string
  /** the file's blob SHA — round-trip it back as baseBlob for the CAS fast path */
  blob: string
}

export interface SearchHit {
  path: string
  title?: string
  snippet?: string
  /** Query-highlighted excerpt (matched terms wrapped in **). */
  highlight?: string
}

export type WriteResult =
  | { status: 'merged'; version: string }
  | { status: 'proposal' | 'conflict'; prUrl: string; proposalId: string }

export interface ProposeInput {
  path: string
  content: string
  baseVersion?: string
  baseBlob?: string
}

export class TeioContextClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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
      throw new Error(`teio-context request failed (${res.status}): ${message}`)
    }
    return data as T
  }

  // ---- reads (share OUT) ----

  async listSpaces(): Promise<SpaceSummary[]> {
    const res = await this.request<{ spaces: SpaceSummary[] }>('GET', '/api/spaces')
    return res.spaces
  }

  async getVersion(spaceId: string): Promise<{ sha: string; updatedAt: string }> {
    return this.request('GET', `/api/spaces/${encodeURIComponent(spaceId)}/version`)
  }

  async getDocument(spaceId: string, path: string): Promise<DocumentRead> {
    return this.request('GET', `/api/spaces/${encodeURIComponent(spaceId)}/context?path=${encodeURIComponent(path)}`)
  }

  async search(spaceId: string, query: string): Promise<SearchHit[]> {
    const res = await this.request<{ results: SearchHit[] }>(
      'GET',
      `/api/spaces/${encodeURIComponent(spaceId)}/search?q=${encodeURIComponent(query)}`,
    )
    return res.results
  }

  async listProposals(spaceId: string): Promise<unknown[]> {
    const res = await this.request<{ proposals: unknown[] }>('GET', `/api/spaces/${encodeURIComponent(spaceId)}/proposals`)
    return res.proposals
  }

  // ---- writes (update IN) ----

  async proposeUpdate(spaceId: string, input: ProposeInput): Promise<WriteResult> {
    return this.request('POST', `/api/spaces/${encodeURIComponent(spaceId)}/context`, {
      path: input.path,
      content: input.content,
      base_version: input.baseVersion,
      base_blob: input.baseBlob,
    })
  }

  async deletePath(spaceId: string, input: { path: string; baseVersion?: string }): Promise<WriteResult> {
    const qs = new URLSearchParams({ path: input.path })
    if (input.baseVersion) qs.set('base_version', input.baseVersion)
    return this.request('DELETE', `/api/spaces/${encodeURIComponent(spaceId)}/context?${qs.toString()}`)
  }

  async movePath(spaceId: string, input: { from: string; to: string; baseVersion?: string }): Promise<WriteResult> {
    return this.request('POST', `/api/spaces/${encodeURIComponent(spaceId)}/context/move`, {
      from: input.from,
      to: input.to,
      base_version: input.baseVersion,
    })
  }
}
