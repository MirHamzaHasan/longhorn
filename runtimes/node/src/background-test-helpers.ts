import { afterEach,beforeEach } from 'vitest'
import { openPostgres } from './postgres.js'
import type { PostgresDatabase } from './postgres.js'

export function backgroundFixture() {
  if (process.env.LONGHORN_PG_TEST_OWNED!=='true' || !process.env.LONGHORN_PG_TEST_URL || !process.env.LONGHORN_PG_APP_URL) throw new Error('Use pnpm test:postgres with its owned native cluster')
  const databases: PostgresDatabase[]=[],resources: { close(): Promise<void> }[]=[]
  async function open(owner=false) {
    const db=await openPostgres({ connectionString: (owner ? process.env.LONGHORN_PG_TEST_URL : process.env.LONGHORN_PG_APP_URL)!,maxConnections: 4 })
    databases.push(db);return db
  }
  beforeEach(async () => { const db=await open(true);await db.execute('TRUNCATE longhorn_queue.jobs,longhorn_scheduler.schedules,longhorn_pg_example.task_reports') })
  afterEach(async () => {
    for (const resource of resources.splice(0).reverse()) await resource.close()
    for (const database of databases.splice(0).reverse()) await database.close()
  })
  return { open,resources }
}
export function deferred() { let resolve!: () => void;const promise=new Promise<void>(done => { resolve=done });return { resolve,promise } }
export const dataSchema={ '~standard': { version: 1 as const,vendor: 'native-background-qa',validate(input: unknown) {
  const data=input as { value?: unknown } | undefined
  return typeof data?.value==='number' ? { value: { value: data.value } } : { issues: [{ message: 'Expected number' }] }
} } }
