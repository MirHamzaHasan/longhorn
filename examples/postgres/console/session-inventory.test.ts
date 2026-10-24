import { expect, it } from 'vitest'
import { readSessionPage } from './session-inventory.js'
const first = { id: '1'.repeat(32), expiresAt: 100, current: true }, second = { id: '2'.repeat(32), expiresAt: 100, current: false }
it('keeps public fields and rejects invalid or duplicated session pages', () => {
  expect(readSessionPage({ sessions: [{ ...first, tokenHash: 'private' }], nextCursor: null })).toEqual({ sessions: [first], nextCursor: null })
  for (const value of [{ sessions: [{ ...first, id: [first.id] }], nextCursor: null }, { sessions: [first, first], nextCursor: null }, { sessions: [second, first], nextCursor: null }, { sessions: [{ ...first, current: 'yes' }], nextCursor: null }, { sessions: [first], nextCursor: 'next' }]) expect(() => readSessionPage(value)).toThrow('Invalid session')
})
it('fences repeated and current-session rows across continuation pages', () => {
  expect(readSessionPage({ sessions: [second], nextCursor: null }, [first]).sessions).toEqual([second])
  expect(() => readSessionPage({ sessions: [first], nextCursor: null }, [first])).toThrow('Invalid session')
  expect(() => readSessionPage({ sessions: [{ ...second, current: true }], nextCursor: null }, [first])).toThrow('Invalid session continuation')
})
