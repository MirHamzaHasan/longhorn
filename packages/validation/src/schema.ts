import type { StandardSchemaV1 } from '@standard-schema/spec'
import { normalizeIssues, ValidationError } from './issues.js'
import type { ValidationIssue } from './issues.js'

export type ParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] }

/** Supports both synchronous and asynchronous Standard Schema implementations. */
export async function safeParse<Input, Output>(
  schema: StandardSchemaV1<Input, Output>,
  value: unknown,
): Promise<ParseResult<Output>> {
  const result = await schema['~standard'].validate(value)
  if (result.issues) return { success: false, issues: normalizeIssues(result.issues) }
  return { success: true, data: result.value }
}

export async function parse<Input, Output>(
  schema: StandardSchemaV1<Input, Output>,
  value: unknown,
): Promise<Output> {
  const result = await safeParse(schema, value)
  if (!result.success) throw new ValidationError(result.issues)
  return result.data
}
