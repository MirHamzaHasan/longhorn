import { sValidator } from '@hono/standard-validator'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ValidationTargets } from 'hono'
import { normalizeIssues } from './issues.js'

export type ValidationTarget = keyof ValidationTargets

/** Hono owns request parsing and typed c.req.valid(); LongHorn supplies error formatting. */
export function validate<Schema extends StandardSchemaV1, Target extends ValidationTarget>(
  target: Target,
  schema: Schema,
) {
  return sValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({
        error: 'Validation failed',
        target,
        issues: normalizeIssues(result.error),
      }, 400)
    }
  })
}
