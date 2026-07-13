import { z } from 'zod'
import { AppError } from './errors'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  // GitHub App config is OPTIONAL at the env level so DB/Clerk-only paths boot
  // before the App/org exists. Read it through getGitHubConfig(), which throws a
  // clean 503 when it's missing rather than letting getEnv() reject every route.
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_ORG: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  /** Comma-separated Clerk user ids allowed to create spaces (lib/auth/staff.ts). */
  STAFF_USER_IDS: z.string().optional(),
  /** Bearer secret the backfill cron must present (app/api/cron/backfill). */
  CRON_SECRET: z.string().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

/** Parse + validate process.env once. Throws a readable error if misconfigured. */
export function getEnv(): Env {
  if (!cached) cached = schema.parse(process.env)
  return cached
}

export interface GitHubConfig {
  appId: number
  privateKey: string
  org: string
}

/**
 * The GitHub App config, or a clean `503 github_unconfigured` if it isn't set
 * yet. Lets the DB/Clerk surface (list spaces, search, members, tokens) run
 * before the paid org + App exist; only the GitHub-touching paths (provision,
 * write, import) fail — and they fail loud and legible, not with a crypto crash.
 * Private keys are often stored with literal `\n`; normalize to real newlines.
 */
export function getGitHubConfig(env: Env = getEnv()): GitHubConfig {
  const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_ORG } = env
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !GITHUB_ORG) {
    throw new AppError(
      'GitHub App is not configured (set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_ORG)',
      'github_unconfigured',
      503,
    )
  }
  const privateKey = GITHUB_APP_PRIVATE_KEY.includes('\\n')
    ? GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n')
    : GITHUB_APP_PRIVATE_KEY
  return { appId: Number(GITHUB_APP_ID), privateKey, org: GITHUB_ORG }
}
