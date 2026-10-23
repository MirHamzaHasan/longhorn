import type { Database, Migration, SqlExecutor, SqlRow, SqlValue } from '@longhorn/database'
import { z } from 'zod'
export const exampleSchema = 'longhorn_pg_example'
export const taskMigrations: readonly Migration[] = [{ id: 'postgres_tasks/001_tasks', statements: [
  `CREATE TABLE longhorn_pg_example.tasks (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200 AND char_length(btrim(title)) > 0),
    completed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
  )`,
  'CREATE INDEX tasks_completed_id ON longhorn_pg_example.tasks(completed,id)',
] }]
export const createTaskSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict()
export const updateTaskSchema = z.object({ completed: z.boolean() }).strict()
const id = z.string().refine((value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n, 'Expected a positive int64 ID')
export const taskParams = z.object({ id })
export const taskQuery = z.object({
  after: id.optional(), completed: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  limit: z.string().regex(/^\d+$/).default('20').transform(Number).pipe(z.number().int().min(1).max(100)),
})
export type Task = { readonly id: string; readonly title: string; readonly completed: boolean; readonly createdAt: string }
function task(row: SqlRow): Task {
  if (typeof row.id !== 'bigint' || typeof row.title !== 'string' || typeof row.completed !== 'boolean' || typeof row.created_at !== 'string') throw new Error('Invalid PostgreSQL task row')
  return { id: row.id.toString(), title: row.title, completed: row.completed, createdAt: row.created_at }
}
export class PostgresTasksStore {
  constructor(private readonly database: Database) {}
  async list(input: z.output<typeof taskQuery>): Promise<{ tasks: Task[]; nextCursor: string | null }> {
    const args: SqlValue[] = [], conditions: string[] = []
    if (input.after !== undefined) { args.push(input.after); conditions.push(`id > $${args.length}::bigint`) }
    if (input.completed !== undefined) { args.push(input.completed); conditions.push(`completed = $${args.length}::boolean`) }
    args.push(input.limit + 1)
    const rows = (await this.database.execute({ sql: `SELECT id,title,completed,created_at FROM longhorn_pg_example.tasks
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY id LIMIT $${args.length}`, args })).rows
    const tasks = rows.slice(0, input.limit).map(task)
    return { tasks, nextCursor: rows.length > input.limit ? tasks.at(-1)!.id : null }
  }
  async get(id: string): Promise<Task | undefined> {
    const row = (await this.database.execute({ sql: 'SELECT id,title,completed,created_at FROM longhorn_pg_example.tasks WHERE id=$1::bigint', args: [id] })).rows[0]
    return row ? task(row) : undefined
  }
  async create(title: string): Promise<Task> {
    return this.createIn(this.database, title)
  }
  async createIn(executor: SqlExecutor, title: string): Promise<Task> {
    return task((await executor.execute({ sql: 'INSERT INTO longhorn_pg_example.tasks(title) VALUES($1) RETURNING id,title,completed,created_at', args: [title] })).rows[0]!)
  }
  async update(id: string, completed: boolean): Promise<Task | undefined> {
    const row = (await this.database.execute({ sql: 'UPDATE longhorn_pg_example.tasks SET completed=$1 WHERE id=$2::bigint RETURNING id,title,completed,created_at', args: [completed, id] })).rows[0]
    return row ? task(row) : undefined
  }
  async delete(id: string): Promise<boolean> {
    return (await this.database.execute({ sql: 'DELETE FROM longhorn_pg_example.tasks WHERE id=$1::bigint', args: [id] })).rowsAffected === 1
  }
}
