export const PACKAGE_NAME = '@longhorn/database'

export type SqlValue = string | number | bigint | boolean | null | Uint8Array
export type SqlRow = Readonly<Record<string, SqlValue>>
export type SqlStatement = string | { readonly sql: string; readonly args?: readonly SqlValue[] }
export type QueryResult = {
  readonly rows: readonly SqlRow[]
  readonly rowsAffected: number
  readonly lastInsertId: bigint | undefined
}

export interface SqlExecutor {
  /** Native SQL syntax/parameters remain provider-specific. Older custom executors may omit this. */
  readonly dialect?: 'sqlite' | 'postgres'
  execute(statement: SqlStatement): Promise<QueryResult>
}

export interface Database extends SqlExecutor {
  transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export { migrate } from './migrations.js'
export type { Migration } from './migrations.js'
