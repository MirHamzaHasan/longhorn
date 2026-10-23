import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** Package managers and native watchers may create separate process groups. */
export async function signalProcessTree(root: number, signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (process.platform === 'win32') {
    await promisify(execFile)('taskkill', ['/pid', String(root), '/T'])
    return
  }
  const { stdout } = await promisify(execFile)('ps', ['-axo', 'pid=,ppid='])
  const children = new Map<number, number[]>()
  for (const line of stdout.trim().split('\n')) {
    const [pid, parent] = line.trim().split(/\s+/).map(Number)
    if (!pid || !parent) continue
    const siblings = children.get(parent) ?? []
    siblings.push(pid)
    children.set(parent, siblings)
  }
  function visit(pid: number) {
    for (const child of children.get(pid) ?? []) visit(child)
    try { process.kill(pid, signal) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  // Signal leaves first, before a wrapper can exit and reparent its children.
  visit(root)
}
