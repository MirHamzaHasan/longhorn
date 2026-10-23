import { describe, it, expect } from 'vitest'
import { token, provide, Container } from './index.js'

describe('Container', () => {
    it('resolves a provider with no deps', () => {
        const NumToken = token<number>('num')
        const container = new Container()
        container.register(provide(NumToken, { factory: () => 42 }))

        expect(container.resolve(NumToken)).toBe(42)
    })

    it('resolves nested dependencies', () => {
        const DbToken = token<{ query: () => string }>('db')
        const UsersToken = token<{ list: () => string }>('users')

        const container = new Container()
        container.register(provide(DbToken, { factory: () => ({ query: () => 'rows' }) }))
        container.register(
            provide(UsersToken, {
                deps: [DbToken],
                factory: (db) => ({ list: () => db.query() }),
            })
        )

        expect(container.resolve(UsersToken).list()).toBe('rows')
    })

    it('caches instances (singleton behavior)', () => {
        const CounterToken = token<{ n: number }>('counter')
        let calls = 0
        const container = new Container()
        container.register(
            provide(CounterToken, {
                factory: () => {
                    calls++
                    return { n: calls }
                },
            })
        )

        const a = container.resolve(CounterToken)
        const b = container.resolve(CounterToken)

        expect(a).toBe(b)
        expect(calls).toBe(1)
    })

    it('throws when resolving an unregistered token', () => {
        const MissingToken = token('missing')
        const container = new Container()
        expect(() => container.resolve(MissingToken)).toThrow()
    })

    it('throws when registering the same token twice', () => {
        const NumToken = token<number>('num')
        const container = new Container()
        container.register(provide(NumToken, { factory: () => 1 }))
        expect(() =>
            container.register(provide(NumToken, { factory: () => 2 }))
        ).toThrow()
    })
})

it('throws a clear error on circular dependencies', () => {
    const AToken = token<unknown>('a')
    const BToken = token<unknown>('b')

    const container = new Container()
    container.register(provide(AToken, { deps: [BToken], factory: (b) => ({ b }) }))
    container.register(provide(BToken, { deps: [AToken], factory: (a) => ({ a }) }))

    expect(() => container.resolve(AToken)).toThrow(/circular/i)
})

it('allows overriding a provider for tests', () => {
    const DbToken = token<{ query: () => string }>('db')
    const container = new Container()
    container.register(provide(DbToken, { factory: () => ({ query: () => 'real' }) }))

    expect(container.resolve(DbToken).query()).toBe('real')

    container.override(provide(DbToken, { factory: () => ({ query: () => 'fake' }) }))
    expect(container.resolve(DbToken).query()).toBe('fake')
})