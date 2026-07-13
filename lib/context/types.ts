export type Role = 'owner' | 'editor' | 'reader'

export interface Principal {
  type: 'user' | 'token'
  id: string
  display?: string
}

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

export type WriteResult =
  | { status: 'merged'; version: string }
  | { status: 'proposal' | 'conflict'; prUrl: string; proposalId: string }

export interface SearchHit {
  path: string
  title?: string
  /** Static leading excerpt (first ~200 chars), for list display. */
  snippet?: string
  /** Query-highlighted excerpt (matched terms wrapped in **), computed per query via ts_headline. */
  highlight?: string
}

export interface ProposeInput {
  path: string
  content: string
  baseVersion?: string
  baseBlob?: string
  /** Correlation id recorded in audit_log (lib/request-id.ts). */
  requestId?: string
}

/**
 * The one core interface. Adapters (MCP, TEIO) are thin translators over this.
 * Phase 1 implements the read path; writes/search land in Phases 2-3.
 */
export interface ContextService {
  listSpaces(principal: Principal): Promise<SpaceSummary[]>
  getVersion(principal: Principal, spaceId: string): Promise<{ sha: string; updatedAt: string }>
  getDocument(principal: Principal, spaceId: string, path: string): Promise<DocumentRead>
  search(principal: Principal, spaceId: string, query: string): Promise<SearchHit[]>
  listProposals(principal: Principal, spaceId: string): Promise<unknown[]>
  proposeUpdate(principal: Principal, spaceId: string, input: ProposeInput): Promise<WriteResult>
  deletePath(principal: Principal, spaceId: string, input: { path: string; baseVersion?: string; requestId?: string }): Promise<WriteResult>
  movePath(
    principal: Principal,
    spaceId: string,
    input: { from: string; to: string; baseVersion?: string; requestId?: string },
  ): Promise<WriteResult>
}
