import { createApp } from './app.js'
import { defaultConfig } from './config.js'
import type { Task, TaskListQuery, TasksStore } from './tasks.js'

/** Explicit test fixture. The executable application always uses SQLite. */
class MemoryTasksStore implements TasksStore {
  private readonly tasks = new Map<string, Task>()
  private nextId = 1
  async list(query: TaskListQuery) {
    const rows = [...this.tasks.values()].filter(task => (query.after === undefined || BigInt(task.id) > BigInt(query.after))
      && (query.completed === undefined || task.completed === query.completed)).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)
    const tasks = rows.slice(0, query.limit)
    return { tasks, nextCursor: rows.length > query.limit ? tasks.at(-1)!.id : null }
  }
  async counts() {
    const total = this.tasks.size, completed = [...this.tasks.values()].filter(task => task.completed).length
    return { total, completed, pending: total - completed }
  }
  async get(id: string) { return this.tasks.get(id) }
  async create(title: string) {
    const task = Object.freeze({ id: String(this.nextId++), title, completed: false })
    this.tasks.set(task.id, task)
    return task
  }
  async update(id: string, completed: boolean) {
    const existing = this.tasks.get(id)
    if (!existing) return undefined
    const task = Object.freeze({ ...existing, completed })
    this.tasks.set(id, task)
    return task
  }
  async delete(id: string) { return this.tasks.delete(id) }
}

export function createTestApp() {
  return createApp(defaultConfig, undefined, new MemoryTasksStore())
}
