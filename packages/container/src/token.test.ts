import { describe, it, expect } from 'vitest'
import { token } from './index.js'

describe('token', () => {
  it('creates unique tokens even with the same description', () => {
    const a = token<number>('db')
    const b = token<number>('db')
    expect(a.id).not.toBe(b.id)
  })

  it('keeps the description for debugging', () => {
    const t = token<string>('users')
    expect(t.description).toBe('users')
  })

  it('is frozen', () => {
    const t = token('x')
    expect(Object.isFrozen(t)).toBe(true)
  })
})