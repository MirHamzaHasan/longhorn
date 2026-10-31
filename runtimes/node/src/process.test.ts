import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startProcess } from './process.js'
import type { ManagedProcess } from './process.js'

const fixture = fileURLToPath(new URL('../../../scripts/fixtures/managed-process.mjs', import.meta.url))
const handles: ManagedProcess<unknown>[] = [], directories: string[] = []
afterEach(async () => {
  await Promise.allSettled(handles.splice(0).map(handle => handle.close()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})
const ready = (line: string) => { const value = JSON.parse(line); return value.ready ? value as { value: string; inherited: string; args: string[] } : undefined }
async function open(mode = 'ready', extra = {}) {
  const handle = await startProcess({ executable: process.execPath, args: [fixture, mode], ready, ...extra })
  handles.push(handle); return handle
}
async function pidFile() { const directory = await mkdtemp(join(tmpdir(), 'longhorn process ')); directories.push(directory); return join(directory, 'pid') }
const gone = (pid: number) => { expect(() => process.kill(pid, 0)).toThrow() }

it('snapshots argv/env, avoids ambient inheritance and confirms actual exit on repeated close', async () => {
  const previous = process.env.PROCESS_FIXTURE_PARENT
  process.env.PROCESS_FIXTURE_PARENT = 'private parent value'
  try {
    const args = [fixture, 'ready', 'literal;$(command)'], env = { PROCESS_FIXTURE_VALUE: 'original', PROCESS_FIXTURE_DRAIN_MS: '50' }
    const pending = startProcess({ executable: process.execPath, args, env, ready })
    args[2] = 'changed'; env.PROCESS_FIXTURE_VALUE = 'changed'
    const handle = await pending; handles.push(handle)
    expect(handle.value).toEqual({ ready: true, value: 'original', inherited: 'absent', args: ['literal;$(command)'] })
    const closing = handle.close(); expect(handle.close()).toBe(closing)
    expect(handle.state).toBe('stopping'); process.kill(handle.pid, 0)
    await closing; gone(handle.pid)
    expect(await handle.exited).toMatchObject({ code: 0, reason: 'closed', forced: false })
  } finally { if (previous === undefined) delete process.env.PROCESS_FIXTURE_PARENT; else process.env.PROCESS_FIXTURE_PARENT = previous }
})

it('supports explicit environment inheritance with deletion overrides', async () => {
  const handle = await open('ready', { inheritEnv: true, env: { PROCESS_FIXTURE_PARENT: undefined } })
  expect(handle.value.inherited).toBe('absent'); await handle.close()
})

it('rejects preflight errors and failed spawn without exposing executable/args/diagnostics', async () => {
  for (const options of [{ executable: 'relative' }, { executable: '/not-present/private-binary' }, { executable: process.execPath, startupTimeoutMs: 0 }, { executable: process.execPath, env: { 'bad=key': 'secret' } }]) {
    await expect(startProcess({ args: [fixture, 'ready'], ready, ...options })).rejects.toThrow(/^Managed process operation failed: (input|spawn)$/)
  }
  await expect(startProcess({ executable: process.execPath, args: [fixture, 'exit'], ready })).rejects.toMatchObject({ code: 'exit' })
})

it('cancels startup and waits until the actual entered child is gone', async () => {
  const path = await pidFile(), controller = new AbortController()
  const startup = startProcess({ executable: process.execPath, args: [fixture, 'wait'], env: { PROCESS_FIXTURE_PID_FILE: path }, ready, signal: controller.signal })
  const observed = startup.catch(error => error)
  let pid: number | undefined
  for (let i = 0; i < 200 && !pid; i++) { try { pid = Number(await readFile(path, 'utf8')) } catch { /* Not created yet. */ } if (!pid) await new Promise(resolve => setTimeout(resolve, 5)) }
  expect(pid).toBeGreaterThan(0); controller.abort()
  expect(await observed).toMatchObject({ code: 'aborted' }); gone(pid!)
})

it('does not resolve readiness if its parser aborts acquisition', async () => {
  const controller = new AbortController()
  await expect(startProcess({ executable: process.execPath, args: [fixture, 'ready'], signal: controller.signal, ready: line => { controller.abort(); return ready(line) } })).rejects.toMatchObject({ code: 'aborted' })
})

it('removes the acquisition signal after readiness', async () => {
  const controller = new AbortController(), handle = await open('ready', { signal: controller.signal })
  controller.abort(); expect(handle.state).toBe('running'); await handle.close()
})

it('decodes a complete UTF-8 readiness line across separate output chunks', async () => {
  const handle = await open('split')
  expect(handle.value.value).toBe('café'); await handle.close()
})

it('rejects asynchronous readiness parsers and observes their rejected result', async () => {
  await expect(open('ready', { ready: async () => { throw new Error('private parser diagnostic') } })).rejects.toMatchObject({ code: 'ready' })
})

it('continues charging output after readiness and joins the failed child', async () => {
  const handle = await open('runtime-output', { maxOutputBytes: 1024 })
  expect(await handle.exited).toMatchObject({ reason: 'output', forced: false })
  expect(handle.stats().outputBytes).toBe(1025)
  await expect(handle.close()).rejects.toMatchObject({ code: 'output' }); gone(handle.pid)
})

it('terminates startup on deadlines, UTF-8/parser errors and stdout/stderr limits', async () => {
  await expect(startProcess({ executable: process.execPath, args: [fixture, 'wait'], ready, startupTimeoutMs: 100 })).rejects.toMatchObject({ code: 'timeout' })
  await expect(open('utf8')).rejects.toMatchObject({ code: 'ready' })
  await expect(open('ready', { ready: () => { throw new Error('private diagnostic credential') } })).rejects.toThrow(/^Managed process operation failed: ready$/)
  for (const mode of ['stdout', 'stderr']) await expect(open(mode, { maxOutputBytes: 100 })).rejects.toMatchObject({ code: 'output' })
  await expect(open('stdout', { maxOutputBytes: 20000, maxLineBytes: 100 })).rejects.toMatchObject({ code: 'output' })
})

it('forces a noncooperative child, waits for exit and reports shutdown failure', async () => {
  const handle = await open('ignore', { shutdownTimeoutMs: 30 })
  await expect(handle.close()).rejects.toMatchObject({ code: 'shutdown-timeout' })
  expect(await handle.exited).toMatchObject({ signal: 'SIGKILL', forced: true }); gone(handle.pid)
})

it('exposes unexpected runtime exit and reports it during cleanup', async () => {
  const handle = await open(); process.kill(handle.pid, 'SIGKILL')
  expect(await handle.exited).toMatchObject({ reason: 'exit', signal: 'SIGKILL', forced: false })
  await expect(handle.close()).rejects.toMatchObject({ code: 'exit' }); gone(handle.pid)
})

it('keeps independently owned sibling processes running when one closes', async () => {
  const first = await open(), second = await open()
  await first.close(); gone(first.pid)
  expect(second.state).toBe('running'); process.kill(second.pid, 0)
  await second.close()
})
