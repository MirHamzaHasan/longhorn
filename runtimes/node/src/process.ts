import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

export type ProcessFailure = 'input' | 'spawn' | 'ready' | 'timeout' | 'aborted' | 'output' | 'exit' | 'shutdown-timeout'
export class ProcessResourceError extends Error {
  constructor(readonly code: ProcessFailure) { super('Managed process operation failed: ' + code); this.name = 'ProcessResourceError' }
}
export type ProcessExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null; readonly reason: ProcessFailure | 'closed'; readonly forced: boolean }
export type ManagedProcess<T> = {
  readonly pid: number
  readonly value: T
  readonly exited: Promise<ProcessExit>
  readonly state: 'starting' | 'running' | 'stopping' | 'exited'
  stats(): { readonly outputBytes: number; readonly forced: boolean }
  close(): Promise<void>
}
export type ProcessOptions<T> = {
  readonly executable: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly inheritEnv?: boolean
  /** Synchronous bounded stdout-line parser. undefined means not ready. */
  readonly ready: (line: string) => T | undefined
  readonly signal?: AbortSignal
  readonly startupTimeoutMs?: number
  readonly shutdownTimeoutMs?: number
  readonly maxOutputBytes?: number
  readonly maxLineBytes?: number
}
const input = () => new ProcessResourceError('input')
const text = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0')
function budget(value: number, maximum: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw input(); return value }

/** Own one trusted direct child, bounded startup output and actual process/pipe lifetime. */
export async function startProcess<T>(options: ProcessOptions<T>): Promise<ManagedProcess<T>> {
  if (!text(options?.executable) || !isAbsolute(options.executable) || typeof options.ready !== 'function') throw input()
  const executable = options.executable, ready = options.ready, cwd = options.cwd ?? process.cwd()
  if (!text(cwd) || !isAbsolute(cwd) || (options.inheritEnv !== undefined && typeof options.inheritEnv !== 'boolean')) throw input()
  const args = options.args ?? []
  if (!Array.isArray(args) || args.length > 256 || args.some(value => !text(value))) throw input()
  if (options.env !== undefined && (typeof options.env !== 'object' || options.env === null || Array.isArray(options.env))) throw input()
  const env = options.inheritEnv ? { ...process.env } : Object.create(null) as Record<string, string | undefined>
  const entries = Object.entries(options.env ?? {})
  if (entries.length > 256) throw input()
  for (const [key, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || (value !== undefined && !text(value))) throw input()
    if (value === undefined) delete env[key]; else env[key] = value
  }
  let bytes = Buffer.byteLength(executable) + Buffer.byteLength(cwd)
  if (bytes > 1048576) throw input()
  for (const value of [...args, ...Object.entries(env).flatMap(([key, value]) => [key, value ?? ''])]) { bytes += Buffer.byteLength(value); if (bytes > 1048576) throw input() }
  const argumentsCopy = [...args], startup = budget(options.startupTimeoutMs ?? 5000, 60000), shutdown = budget(options.shutdownTimeoutMs ?? 10000, 60000)
  const outputLimit = budget(options.maxOutputBytes ?? 65536, 4194304), lineLimit = budget(options.maxLineBytes ?? 4096, 65536)
  const signal = options.signal
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw input()
  if (signal?.aborted) throw new ProcessResourceError('aborted')

  let child: ReturnType<typeof spawn>
  try { child = spawn(executable, argumentsCopy, { cwd, env, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch { throw new ProcessResourceError('spawn') }
  let phase: ManagedProcess<T>['state'] = 'starting', failure: ProcessFailure | undefined, stopping = false, forced = false, alive = true
  let outputBytes = 0, pending = Buffer.alloc(0), forceTimer: ReturnType<typeof setTimeout> | undefined, closing: Promise<void> | undefined
  let resolveReady!: (handle: ManagedProcess<T>) => void, rejectReady!: (error: ProcessResourceError) => void, resolveExit!: (value: ProcessExit) => void
  const result = new Promise<ManagedProcess<T>>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const exited = new Promise<ProcessExit>(resolve => { resolveExit = resolve })
  function stop() {
    if (!alive || stopping) return
    stopping = true; phase = 'stopping'
    try { child.kill('SIGTERM') } catch { failure ??= 'exit' }
    forceTimer = setTimeout(() => {
      if (!alive) return
      forced = true; failure ??= 'shutdown-timeout'
      try { child.kill('SIGKILL') } catch { failure ??= 'exit' }
    }, shutdown)
  }
  function fail(code: ProcessFailure) {
    failure ??= code
    if (code === 'output') { pending = Buffer.alloc(0); child.stdout?.destroy(); child.stderr?.destroy() }
    stop()
  }
  const abort = () => fail('aborted')
  const startupTimer = setTimeout(() => fail('timeout'), startup)
  function detachStartup() { clearTimeout(startupTimer); signal?.removeEventListener('abort', abort) }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  function charge(chunk: Buffer): boolean {
    if (failure) return false
    outputBytes = Math.min(outputLimit + 1, outputBytes + chunk.byteLength)
    if (outputBytes > outputLimit) { fail('output'); return false }
    return true
  }
  child.stdout?.on('data', (chunk: Buffer) => {
    if (!charge(chunk) || phase !== 'starting') return
    pending = Buffer.concat([pending, chunk])
    let end: number
    while (phase === 'starting' && (end = pending.indexOf(10)) >= 0) {
      if (end > lineLimit) { fail('output'); return }
      const line = pending.subarray(0, end); pending = pending.subarray(end + 1)
      let value: T | undefined
      try {
        value = ready(new TextDecoder('utf-8', { fatal: true }).decode(line).replace(/\r$/, ''))
        if (value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function') {
          // Invalid async parsers must not leave an unobserved rejection in the host.
          void Promise.resolve(value).catch(() => {})
          fail('ready'); return
        }
      }
      catch { fail('ready'); return }
      if (phase !== 'starting' || failure) return
      if (value !== undefined) {
        phase = 'running'; detachStartup(); pending = Buffer.alloc(0)
        const handle: ManagedProcess<T> = Object.freeze({ pid: child.pid!, value, exited,
          get state() { return phase }, stats: () => ({ outputBytes, forced }),
          close() {
            closing ??= (async () => {
              stop()
              const outcome = await exited
              if (outcome.reason !== 'closed') throw new ProcessResourceError(outcome.reason)
            })()
            return closing
          },
        })
        resolveReady(handle)
      }
    }
    if (pending.byteLength > lineLimit) fail('output')
  })
  child.stderr?.on('data', charge)
  child.stdout?.on('error', () => fail('output')); child.stderr?.on('error', () => fail('output'))
  child.once('error', () => { failure ??= child.pid === undefined ? 'spawn' : 'exit'; stop() })
  child.once('exit', () => {
    alive = false; detachStartup(); clearTimeout(forceTimer)
    // Only the direct child is owned. Do not wait forever on pipes inherited by descendants.
    child.stdout?.destroy(); child.stderr?.destroy()
  })
  child.once('close', (code, exitSignal) => {
    alive = false; detachStartup(); clearTimeout(forceTimer); pending = Buffer.alloc(0)
    const expected = stopping && !failure && (code === 0 || exitSignal === 'SIGTERM')
    const reason = failure ?? (expected ? 'closed' : 'exit')
    phase = 'exited'
    const outcome = Object.freeze({ code, signal: exitSignal, reason, forced })
    resolveExit(outcome)
    rejectReady(new ProcessResourceError(reason === 'closed' ? 'exit' : reason))
  })
  return result
}
