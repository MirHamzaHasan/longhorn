import { describe, it, expect } from 'vitest'
import { token, provide } from './index.js'

describe('provide', () => {
  it('creates a provider with no deps', () => {
    const NumToken = token<number>('num')
    const p = provide(NumToken, { factory: () => 42 })

    expect(p.token).toBe(NumToken)
    expect(p.deps).toEqual([])
    expect(p.factory()).toBe(42)
  })

  it('creates a provider with typed deps', () => {
    const DbToken = token<{ query: () => string }>('db')
    const UsersToken = token<{ list: () => string }>('users')

    const p = provide(UsersToken, {
      deps: [DbToken],
      factory: (db) => ({ list: () => db.query() }),
    })

    const fakeDb = { query: () => 'rows' }
    expect(p.factory(fakeDb).list()).toBe('rows')
  })

  it('is frozen', () => {
    const NumToken = token<number>('num')
    const p = provide(NumToken, { factory: () => 1 })
    expect(Object.isFrozen(p)).toBe(true)
  })
})