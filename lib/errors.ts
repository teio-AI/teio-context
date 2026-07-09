// Typed errors with an HTTP mapping. Routes translate these via lib/http.ts.

export class AppError extends Error {
  readonly code: string
  readonly httpStatus: number
  constructor(message: string, code: string, httpStatus: number) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.httpStatus = httpStatus
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'unauthorized') {
    super(message, 'unauthorized', 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'forbidden') {
    super(message, 'forbidden', 403)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'validation', 422)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'not found') {
    super(message, 'not_found', 404)
  }
}

export class NotImplementedError extends AppError {
  constructor(feature: string, phase: string) {
    super(`${feature} is not implemented yet (${phase})`, 'not_implemented', 501)
  }
}

/** base_version the caller sent is not reachable (e.g. history rewritten). */
export class UnknownBaseError extends AppError {
  constructor() {
    super('base_version is not reachable; re-pull and retry', 'unknown_base', 409)
  }
}

/**
 * Branch protection / rulesets are unavailable on GitHub's free tier for
 * private repos. Space repos require a paid org (Team/Enterprise). We fail
 * LOUD at provisioning rather than create an unprotected space. (ARCHITECTURE §7.1)
 */
export class FreeTierProtectionError extends AppError {
  constructor(owner: string, repo: string) {
    super(
      `cannot protect ${owner}/${repo}: branch rulesets are unavailable on GitHub's free tier for private repos. ` +
        `Space repos require a paid GitHub org (Team/Enterprise). See ARCHITECTURE §7.1.`,
      'free_tier',
      402,
    )
  }
}

export class GitHubError extends AppError {
  readonly status: number
  readonly op: string
  constructor(status: number, message: string, op: string) {
    super(`GitHub request failed [${op}] (${status}): ${message}`, 'github', 502)
    this.status = status
    this.op = op
  }
}
