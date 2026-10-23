import type { StandardSchemaV1 } from '@standard-schema/spec'

export type ValidationIssue = {
  readonly message: string
  readonly path: readonly (string | number)[]
}

/** Keep the public error format independent of a schema vendor's extra fields. */
export function normalizeIssues(issues: readonly StandardSchemaV1.Issue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    message: issue.message,
    path: (issue.path ?? []).map((segment) => {
      const key = typeof segment === 'object' ? segment.key : segment
      return typeof key === 'symbol' ? String(key) : key
    }),
  }))
}

export class ValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super('Validation failed')
    this.name = 'ValidationError'
  }
}
