import { describe, expect, it } from 'vitest'
import { getGitHubConfig, type Env } from '@/lib/env'
import { AppError } from '@/lib/errors'

const base: Env = {
  DATABASE_URL: 'postgresql://u:p@ep-x-pooler.dev.aws.neon.tech/db?sslmode=require',
  GITHUB_APP_ID: undefined,
  GITHUB_APP_PRIVATE_KEY: undefined,
  GITHUB_ORG: undefined,
  GITHUB_WEBHOOK_SECRET: undefined,
  CLERK_SECRET_KEY: undefined,
  STAFF_USER_IDS: undefined,
  CRON_SECRET: undefined,
}

describe('getGitHubConfig', () => {
  it('throws github_unconfigured (503) when the App env is absent', () => {
    try {
      getGitHubConfig(base)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe('github_unconfigured')
      expect((err as AppError).httpStatus).toBe(503)
    }
  })

  it('throws when only some of the three are set', () => {
    expect(() => getGitHubConfig({ ...base, GITHUB_APP_ID: '5', GITHUB_ORG: 'teio' })).toThrow(/not configured/)
  })

  it('returns parsed config and normalizes an escaped-newline private key', () => {
    const cfg = getGitHubConfig({
      ...base,
      GITHUB_APP_ID: '4256555',
      GITHUB_APP_PRIVATE_KEY: '-----BEGIN-----\\nline\\n-----END-----',
      GITHUB_ORG: 'teio',
    })
    expect(cfg.appId).toBe(4256555)
    expect(cfg.org).toBe('teio')
    expect(cfg.privateKey).toBe('-----BEGIN-----\nline\n-----END-----') // \n unescaped
  })
})
