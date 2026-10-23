import { readFile } from 'node:fs/promises'
import { env as processEnv } from 'node:process'
import { parseEnv } from 'node:util'
import type { Environment } from '@longhorn/config'

export type ReadEnvOptions = {
  /** Files are read in order; later files override earlier files. */
  files?: readonly (string | URL)[]
  /** Override the process environment source, e.g. in tests. */
  env?: Environment
  /** Ignore ENOENT only. Other file errors still reject. */
  ignoreMissing?: boolean
}

/** Snapshot .env files and process variables without changing process.env. */
export async function readEnv(options: ReadEnvOptions = {}): Promise<Environment> {
  const environment = { ...(options.env ?? processEnv) }
  const values: Record<string, string> = Object.create(null)

  for (const file of options.files ?? []) {
    let contents: string
    try {
      contents = await readFile(file, 'utf8')
    } catch (error) {
      if (options.ignoreMissing && error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
    Object.assign(values, parseEnv(contents))
  }

  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) values[key] = value
  }
  return Object.freeze(values)
}
