import { getGitHubConfig } from '../env'
import { InstallationTokenProvider } from './app-auth'

let _provider: InstallationTokenProvider | null = null

/**
 * Process-wide cached installation-token provider. Constructing a fresh
 * InstallationTokenProvider per request defeats its in-memory token cache, so
 * every request would pay a full JWT mint + token exchange. Lazily built, and
 * throws `github_unconfigured` (503) if the App env isn't set yet — so DB-only
 * routes never touch this.
 */
export function getInstallationTokenProvider(): InstallationTokenProvider {
  if (!_provider) {
    const { appId, privateKey } = getGitHubConfig()
    _provider = new InstallationTokenProvider(appId, privateKey)
  }
  return _provider
}
