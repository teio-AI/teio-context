import { getEnv, getPrivateKey } from '../env'
import { InstallationTokenProvider } from './app-auth'

let _provider: InstallationTokenProvider | null = null

/**
 * Process-wide cached installation-token provider. Constructing a fresh
 * InstallationTokenProvider per request (as Phase 1's POST /api/spaces did)
 * defeats its in-memory token cache — each request pays a full JWT mint +
 * token exchange instead of reusing the ~60min-lived token. Lazily built so
 * `next build` doesn't require GitHub env vars at import time.
 */
export function getInstallationTokenProvider(): InstallationTokenProvider {
  if (!_provider) {
    const env = getEnv()
    _provider = new InstallationTokenProvider(env.GITHUB_APP_ID, getPrivateKey(env))
  }
  return _provider
}
