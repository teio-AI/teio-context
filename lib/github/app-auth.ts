import { createSign } from 'node:crypto'
import { GitHubError } from '../errors'

export type FetchImpl = typeof fetch

const API_BASE = 'https://api.github.com'
const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'teio-context',
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Mint a GitHub App JWT (RS256). `iss` = App id, valid ~9 min.
 * `now` is injectable for deterministic tests.
 */
export function makeAppJwt(appId: string | number, privateKeyPem: string, now: number = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: Number(appId) }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  signer.end()
  const signature = b64url(signer.sign(privateKeyPem))
  return `${header}.${payload}.${signature}`
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

/**
 * Resolve the installation id for the account that owns space repos. Works for
 * an org (`/orgs/{owner}/installation`) or a personal account
 * (`/users/{owner}/installation`) — the latter is the free dev-mode path.
 */
export async function getInstallationId(
  appId: string | number,
  privateKeyPem: string,
  owner: string,
  ownerType: 'org' | 'user' = 'org',
  fetchImpl: FetchImpl = fetch,
): Promise<number> {
  const jwt = makeAppJwt(appId, privateKeyPem)
  const path = ownerType === 'user' ? `/users/${owner}/installation` : `/orgs/${owner}/installation`
  const res = await fetchImpl(`${API_BASE}${path}`, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` },
  })
  if (!res.ok) throw new GitHubError(res.status, await safeText(res), `GET ${path}`)
  const json = (await res.json()) as { id: number }
  return json.id
}

interface CachedToken {
  token: string
  expiresAtMs: number
}

/**
 * Mints and caches short-lived installation access tokens (spike-confirmed
 * ~60 min lifetime). Refreshes 60s before expiry.
 */
export class InstallationTokenProvider {
  private readonly cache = new Map<number, CachedToken>()

  constructor(
    private readonly appId: string | number,
    private readonly privateKeyPem: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  async getToken(installationId: number): Promise<string> {
    const cached = this.cache.get(installationId)
    if (cached && cached.expiresAtMs - 60_000 > Date.now()) return cached.token

    const jwt = makeAppJwt(this.appId, this.privateKeyPem)
    const res = await this.fetchImpl(`${API_BASE}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` },
    })
    if (!res.ok) throw new GitHubError(res.status, await safeText(res), 'POST /app/installations/:id/access_tokens')
    const json = (await res.json()) as { token: string; expires_at: string }
    this.cache.set(installationId, { token: json.token, expiresAtMs: Date.parse(json.expires_at) })
    return json.token
  }
}
