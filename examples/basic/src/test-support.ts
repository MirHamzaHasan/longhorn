import { createApp } from './app.js'
import { defaultConfig } from './config.js'
import type { Task, TasksStore } from './tasks.js'

/** Explicit test fixture. The executable application always uses SQLite. */
class MemoryTasksStore implements TasksStore {
  private readonly tasks = new Map<string, Task>()
  private nextId = 1
  async list() { return [...this.tasks.values()] }
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
