import { safeParse, ValidationError } from '@longhorn/validation'
import type { StandardSchemaV1, ValidationIssue } from '@longhorn/validation'

export const PACKAGE_NAME = '@longhorn/config'

export type ConfigSource = Readonly<Record<string, unknown>>
export type Environment = Readonly<Record<string, string | undefined>>

export class ConfigError extends ValidationError {
  constructor(issues: readonly ValidationIssue[]) {
    super(issues)
    this.name = 'ConfigError'
    const fields = [...new Set(issues.map((issue) => issue.path.join('.') || '<root>'))]
    // Startup diagnostics identify fields without printing configuration values.
    this.message = fields.length ? `Invalid configuration: ${fields.join(', ')}` : 'Invalid configuration'
  }
}

/** Later defined keys win. Defaults and transformations belong to the schema. */
export async function loadConfig<Input, Output extends object>(
  schema: StandardSchemaV1<Input, Output>,
  ...sources: readonly ConfigSource[]
): Promise<Readonly<Output>> {
  const values: Record<string, unknown> = Object.create(null)
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) values[key] = value
    }
  }

  const result = await safeParse(schema, values)
  if (!result.success) throw new ConfigError(result.issues)
  return Object.freeze(result.data)
}
