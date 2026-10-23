import { migrate } from '@longhorn/database'
import type { Database, SqlRow } from '@longhorn/database'
import type { Task, TasksStore } from './tasks.js'

const migrations = [{
  id: '001_create_tasks',
  statements: [`CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1))
  ) STRICT`],
}]

function task(row: SqlRow | undefined): Task {
  if (!row || (typeof row.id !== 'bigint' && typeof row.id !== 'number') || typeof row.title !== 'string'
    || (row.completed !== 0 && row.completed !== 1 && row.completed !== 0n && row.completed !== 1n)) {
    throw new Error('Database returned an invalid task row')
  }
  return Object.freeze({ id: String(row.id), title: row.title, completed: row.completed === 1 || row.completed === 1n })
}

export class SqliteTasksStore implements TasksStore {
  constructor(private readonly database: Database) {}

  async list(): Promise<Task[]> {
    return (await this.database.execute('SELECT id, title, completed FROM tasks ORDER BY id')).rows.map(task)
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
  await migrate(database, migrations)
}
