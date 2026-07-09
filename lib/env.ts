import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_ORG: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

/** Parse + validate process.env once. Throws a readable error if misconfigured. */
export function getEnv(): Env {
  if (!cached) cached = schema.parse(process.env)
  return cached
}

/**
 * GitHub App private keys are often stored with literal `\n` in env vars.
 * Normalize to real newlines so node:crypto can parse the PEM.
 */
export function getPrivateKey(env = getEnv()): string {
  return env.GITHUB_APP_PRIVATE_KEY.includes('\\n')
    ? env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n')
    : env.GITHUB_APP_PRIVATE_KEY
}
