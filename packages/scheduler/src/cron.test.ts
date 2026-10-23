import { expect, it } from 'vitest'
import { CronExpression, MAX_TIMESTAMP } from './cron.js'

const time = (iso: string) => Date.parse(iso)
it('uses UTC minute boundaries, numeric lists/ranges/steps and strict next versus inclusive previous', () => {
  const cron = new CronExpression('  0,15,30,45   9-17/2 * * 1-5  ')
  expect(cron.expression).toBe('0,15,30,45 9-17/2 * * 1-5')
  const monday = time('2026-10-26T09:00:00Z')
  expect(cron.next(monday - 1)).toBe(monday)
  expect(cron.next(monday)).toBe(monday + 15 * 60_000)
  expect(cron.previous(monday + 59_999)).toBe(monday)
  expect(cron.next(time('2026-10-23T17:45:00Z'))).toBe(monday)
  expect(new CronExpression('* * * * *').next(-1)).toBe(0)
  expect(new CronExpression('* * * * *').previous(0)).toBe(0)
})
it('implements wildcard day intersection and restricted day union, including Sunday aliases', () => {
  const from = time('2026-11-01T00:00:00Z') // Sunday
  expect(new CronExpression('0 0 * * 0').next(from - 1)).toBe(from)
  expect(new CronExpression('0 0 * * 7').next(from - 1)).toBe(from)
  const union = new CronExpression('0 0 1 * 5')
  expect(union.next(from - 1)).toBe(from)
  expect(union.next(from)).toBe(time('2026-11-06T00:00:00Z')) // Friday
  expect(new CronExpression('0 0 */2 * 1').next(time('2026-11-02T00:00:00Z') - 1)).toBe(time('2026-11-09T00:00:00Z'))
})
it('handles leap days, the non-leap century gap and impossible calendar combinations with bounded searches', () => {
  const leap = new CronExpression('0 0 29 2 *')
  expect(leap.next(time('2096-02-29T00:00:00Z'))).toBe(time('2104-02-29T00:00:00Z'))
  expect(leap.previous(time('2104-02-28T23:59:59Z'))).toBe(time('2096-02-29T00:00:00Z'))
  expect(new CronExpression('0 0 30 2 *').next(0)).toBeUndefined()
  expect(new CronExpression('0 0 31 4 *').previous(Date.now())).toBeUndefined()
  expect(new CronExpression('* * * * *').next(MAX_TIMESTAMP)).toBeUndefined()
})
it('rejects commands, unsupported extensions, malformed fields, unsafe steps and timestamps', () => {
  for (const source of ['', '* * * * * *', '@daily', '0 0 * JAN *', '0 0 * * MON', '60 * * * *', '* 24 * * *',
    '* * 0 * *', '* * * 13 *', '* * * * 8', '*/0 * * * *', '1/2 * * * *', '3-1 * * * *',
    '1,,2 * * * *', '* * ? * *', '0 0 L * *', '0 0 * * 1#2', '*/1001 * * * *', '* * * * * echo unsafe']) {
    expect(() => new CronExpression(source), source).toThrow()
  }
  const cron = new CronExpression('* * * * *')
  expect(() => cron.next(-2)).toThrow('timestamp')
  expect(() => cron.previous(Number.NaN)).toThrow('timestamp')
})
