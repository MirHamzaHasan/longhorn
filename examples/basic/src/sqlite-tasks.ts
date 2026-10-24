import { migrate } from '@longhorn/database'
import type { Database, Migration, SqlRow, SqlValue } from '@longhorn/database'
import type { Task, TaskCounts, TaskListQuery, TaskPage, TasksStore } from './tasks.js'

export const taskMigrations: readonly Migration[] = [{
  id: '001_create_tasks',
  statements: [`CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1))
  ) STRICT`],
}, {
  id: '002_index_tasks_completed_id',
  statements: ['CREATE INDEX tasks_completed_id ON tasks(completed, id)'],
}]

function task(row: SqlRow | undefined): Task {
  if (!row || (typeof row.id !== 'bigint' && typeof row.id !== 'number')
    || (typeof row.id === 'number' && !Number.isSafeInteger(row.id)) || row.id <= 0 || row.id > 9223372036854775807n || typeof row.title !== 'string'
    || (row.completed !== 0 && row.completed !== 1 && row.completed !== 0n && row.completed !== 1n)) {
    throw new Error('Database returned an invalid task row')
  }
  return Object.freeze({ id: String(row.id), title: row.title, completed: row.completed === 1 || row.completed === 1n })
}

export class SqliteTasksStore implements TasksStore {
  constructor(private readonly database: Database) {}

  async list(query: TaskListQuery): Promise<TaskPage> {
    const { limit, after, completed } = query
    const conditions: string[] = [], args: SqlValue[] = []
    if (after !== undefined) { conditions.push('tasks.id > ?'); args.push(BigInt(after)) }
    if (completed !== undefined) { conditions.push('tasks.completed = ?'); args.push(completed) }
    args.push(limit + 1)
    const rows = (await this.database.execute({
      sql: `SELECT id, title, completed FROM tasks ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY tasks.id LIMIT ?`, args,
    })).rows
    const tasks = rows.slice(0, limit).map(task)
    return { tasks, nextCursor: rows.length > limit ? tasks.at(-1)!.id : null }
  }

  async counts(): Promise<TaskCounts> {
    const row = (await this.database.execute('SELECT count(*) AS total, coalesce(sum(completed), 0) AS completed FROM tasks')).rows[0]
    const count = (value: unknown) => {
      const result = typeof value === 'bigint' ? Number(value) : value
      if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) throw new Error('Database returned invalid task counts')
      return result
    }
    const total = count(row?.total), completed = count(row?.completed)
    if (completed > total) throw new Error('Database returned invalid task counts')
    return Object.freeze({ total, completed, pending: total - completed })
  }

  async get(id: string): Promise<Task | undefined> {
    const row = (await this.database.execute({ sql: 'SELECT id, title, completed FROM tasks WHERE id = ?', args: [id] })).rows[0]
    return row ? task(row) : undefined
  }

  async create(title: string): Promise<Task> {
    return task((await this.database.execute({
      sql: 'INSERT INTO tasks (title) VALUES (?) RETURNING id, title, completed', args: [title],
    })).rows[0])
  }

  async update(id: string, completed: boolean): Promise<Task | undefined> {
    const row = (await this.database.execute({
      sql: 'UPDATE tasks SET completed = ? WHERE id = ? RETURNING id, title, completed', args: [completed ? 1 : 0, id],
    })).rows[0]
    return row ? task(row) : undefined
  }

  async delete(id: string): Promise<boolean> {
    return (await this.database.execute({ sql: 'DELETE FROM tasks WHERE id = ?', args: [id] })).rowsAffected > 0
  }
}

export async function initializeTasksDatabase(database: Database): Promise<void> {
  await migrate(database, taskMigrations)
}
