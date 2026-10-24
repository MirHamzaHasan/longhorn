export const PACKAGE_NAME = '@longhorn/logger'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'
export type LogFields = Readonly<Record<string, unknown>>
export type LogValue = string | number | boolean | null | LogValue[] | { [key: string]: LogValue }
export type LogRecord = {
  readonly timestamp: string
  readonly level: Exclude<LogLevel, 'silent'>
  readonly message: string
  readonly fields: Readonly<Record<string, LogValue>>
}
export type LogSink = (record: LogRecord) => void
export type LoggerOptions = {
  level?: LogLevel
  bindings?: LogFields
  sink?: LogSink
  redact?: readonly string[]
  clock?: () => Date
}
export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}

const priorities = { debug: 10, info: 20, warn: 30, error: 40, silent: Infinity }
const defaultRedactions = ['password', 'token', 'secret', 'authorization', 'cookie', 'apiKey']

function normalize(value: unknown, redactions: ReadonlySet<string>, seen = new WeakSet<object>(), depth = 0): LogValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint' || typeof value === 'symbol') return String(value)
  if (typeof value === 'function') return '[Function]'
  if (depth > 10) return '[MaxDepth]'
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  try {
    if (value instanceof Date) return value.toISOString()
    if (value instanceof Error) {
      return normalize({
        name: value.name, message: value.message, stack: value.stack,
        ...(value.cause === undefined ? {} : { cause: value.cause }),
        ...(value instanceof AggregateError ? { errors: value.errors } : {}),
      }, redactions, seen, depth + 1)
    }
    if (Array.isArray(value)) return value.map((item) => normalize(item, redactions, seen, depth + 1))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, redactions.has(key.toLowerCase()) ? '[Redacted]' : normalize(item, redactions, seen, depth + 1),
    ]))
  } catch {
    return '[Unserializable]'
  } finally {
    seen.delete(value)
  }
}

export function consoleLogSink(record: LogRecord): void {
  const line = JSON.stringify(record)
  if (record.level === 'error') console.error(line)
  else if (record.level === 'warn') console.warn(line)
  else console.log(line)
}

/** Sinks borrow one readonly normalized record; failure of one does not skip another. */
export function fanoutLogSinks(sinks: readonly LogSink[]): LogSink {
  if (!Array.isArray(sinks) || sinks.length<1 || sinks.length>16 || [...sinks].some(sink => typeof sink!=='function')) throw new TypeError('Invalid log sinks')
  const selected=[...sinks]
  return record => { for (const sink of selected) { try { sink(record) } catch {} } }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = priorities[options.level ?? 'info']
  const redactions = new Set((options.redact ?? defaultRedactions).map((key) => key.toLowerCase()))
  const sink = options.sink ?? consoleLogSink
  const clock = options.clock ?? (() => new Date())

  function build(bindings: LogFields): Logger {
    function write(level: Exclude<LogLevel, 'silent'>, message: string, fields: LogFields = {}): void {
      if (priorities[level] < threshold) return
      // Logging is best-effort: serialization or sink failures do not fail application work.
      try {
        const normalized = normalize({ ...bindings, ...fields }, redactions)
        const values = normalized && typeof normalized === 'object' && !Array.isArray(normalized)
          ? normalized : { serializationError: normalized }
        sink({ timestamp: clock().toISOString(), level, message, fields: values })
      } catch { /* A failing sink must not crash request handling or cleanup. */ }
    }
    return {
      debug: (message, fields) => write('debug', message, fields),
      info: (message, fields) => write('info', message, fields),
      warn: (message, fields) => write('warn', message, fields),
      error: (message, fields) => write('error', message, fields),
      child: (fields) => build({ ...bindings, ...fields }),
    }
  }
  return build({ ...options.bindings })
}
