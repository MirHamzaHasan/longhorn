import type { Database, SqlExecutor } from '@longhorn/database'

// Internal runtime composition. Public database callers cannot install arbitrary commit callbacks.
const owners = new WeakMap<Database, object>()
const hooks = new WeakMap<object, (executor: SqlExecutor) => Promise<void>>()
export function rememberOwner(database: Database, storage: object): void { owners.set(database, storage) }
export function assertOwner(database: Database, storage: object): void {
  if (owners.get(database) !== storage) throw new Error('Alarm clock requires a Durable SQLite handle for the same Object storage')
}
export function installCommitHook(database: Database, storage: object, hook: (executor: SqlExecutor) => Promise<void>): () => void {
  assertOwner(database, storage)
  if (hooks.has(storage)) throw new Error('Object storage already has an alarm clock')
  hooks.set(storage, hook)
  return () => { if (hooks.get(storage) === hook) hooks.delete(storage) }
}
export async function beforeCommit(storage: object, executor: SqlExecutor): Promise<void> { await hooks.get(storage)?.(executor) }
