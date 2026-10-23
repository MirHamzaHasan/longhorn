import type { Token } from './token.js'
import type { Provider } from './provide.js'

export class Container {
    readonly #providers = new Map<symbol, Provider<unknown>>()
    readonly #instances = new Map<symbol, unknown>()

    register<T>(provider: Provider<T>): this {
        if (this.#providers.has(provider.token.id)) {
            throw new Error(`Provider for "${provider.token.description}" already registered`)
        }
        this.#providers.set(provider.token.id, provider as Provider<unknown>)
        return this
    }

    resolve<T>(token: Token<T>): T {
        return this.#resolve(token, [])
    }

    override<T>(provider: Provider<T>): this {
        this.#providers.set(provider.token.id, provider as Provider<unknown>)
        this.#instances.delete(provider.token.id)
        return this
    }

    #resolve<T>(token: Token<T>, chain: readonly symbol[]): T {
        if (this.#instances.has(token.id)) {
            return this.#instances.get(token.id) as T
        }

        if (chain.includes(token.id)) {
            const path = [...chain, token.id]
                .map((id) => id.description ?? String(id))
                .join(' -> ')
            throw new Error(`Circular dependency detected: ${path}`)
        }

        const provider = this.#providers.get(token.id)
        if (!provider) {
            throw new Error(`No provider registered for "${token.description}"`)
        }

        const nextChain = [...chain, token.id]
        const deps = provider.deps.map((depToken) => this.#resolve(depToken, nextChain))
        const instance = provider.factory(...deps)

        this.#instances.set(token.id, instance)
        return instance as T
    }
}