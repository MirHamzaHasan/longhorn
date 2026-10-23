export const MAX_TIMESTAMP = 8_640_000_000_000_000
const MINUTE = 60_000
type Field = { values: ReadonlySet<number>; sorted: readonly number[]; wildcard: boolean }

function field(source: string, min: number, max: number, sunday = false): Field {
  const values = new Set<number>()
  for (const part of source.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!match) throw new Error('Invalid cron field')
    const range = match[1]!
    const step = match[2] === undefined ? 1 : Number(match[2])
    if (!Number.isSafeInteger(step) || step < 1 || step > 1000 || (match[2] !== undefined && range !== '*' && !range.includes('-'))) throw new Error('Invalid cron step')
    const [from, to] = range === '*' ? [min, max] : range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)]
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from! < min || to! > max || from! > to!) throw new Error('Invalid cron range')
    for (let value = from!; value <= to!; value += step) values.add(sunday && value === 7 ? 0 : value)
  }
  return { values, sorted: [...values].sort((a, b) => a - b), wildcard: source.includes('*') }
}
function timestamp(value: number, min = 0) {
  if (!Number.isSafeInteger(value) || value < min || value > MAX_TIMESTAMP) throw new Error('Invalid cron timestamp')
}

/** Numeric, five-field UTC cron; no command execution or local timezone dependence. */
export class CronExpression {
  readonly expression: string
  private readonly minute: Field
  private readonly hour: Field
  private readonly day: Field
  private readonly month: Field
  private readonly weekday: Field
  constructor(expression: string) {
    if (typeof expression !== 'string' || expression.length > 200) throw new Error('Invalid cron expression')
    const parts = expression.trim().split(/\s+/)
    if (parts.length !== 5) throw new Error('Cron requires five fields')
    this.expression = parts.join(' ')
    this.minute = field(parts[0]!, 0, 59); this.hour = field(parts[1]!, 0, 23)
    this.day = field(parts[2]!, 1, 31); this.month = field(parts[3]!, 1, 12)
    this.weekday = field(parts[4]!, 0, 7, true)
  }
  private matchesDay(date: Date) {
    if (!this.month.values.has(date.getUTCMonth() + 1)) return false
    const day = this.day.values.has(date.getUTCDate()), weekday = this.weekday.values.has(date.getUTCDay())
    return this.day.wildcard || this.weekday.wildcard ? day && weekday : day || weekday
  }
  /** First matching minute strictly after the supplied millisecond. -1 includes epoch zero. */
  next(after: number): number | undefined {
    timestamp(after, -1)
    return this.find((Math.floor(after / MINUTE) + 1) * MINUTE, 1)
  }
  /** Most recent matching minute at or before the supplied millisecond. */
  previous(atOrBefore: number): number | undefined {
    timestamp(atOrBefore)
    return this.find(Math.floor(atOrBefore / MINUTE) * MINUTE, -1)
  }
  private find(cursor: number, direction: 1 | -1): number | undefined {
    if (cursor < 0 || cursor > MAX_TIMESTAMP) return undefined
    const date = new Date(cursor)
    date.setUTCHours(0, 0, 0, 0)
    const hours = direction === 1 ? this.hour.sorted : [...this.hour.sorted].reverse()
    const minutes = direction === 1 ? this.minute.sorted : [...this.minute.sorted].reverse()
    // Numeric patterns recur within nine years if satisfiable, including century leap gaps.
    for (let days = 0; days <= 366 * 9; days++) {
      const midnight = date.getTime()
      if (!Number.isFinite(midnight) || midnight < 0 || midnight > MAX_TIMESTAMP) return undefined
      if (this.matchesDay(date)) {
        for (const hour of hours) for (const minute of minutes) {
          const candidate = midnight + hour * 3_600_000 + minute * MINUTE
          if (candidate <= MAX_TIMESTAMP && (direction === 1 ? candidate >= cursor : candidate <= cursor)) return candidate
        }
      }
      date.setUTCDate(date.getUTCDate() + direction)
    }
    return undefined
  }
}
