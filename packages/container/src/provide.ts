import type { Token } from './token.js'

export type Provider<T> = {
  readonly token: Token<T>
  readonly deps: readonly Token<unknown>[]
  readonly factory: (...args: any[]) => T
}

export function provide<T, D extends readonly Token<unknown>[]>(
  target: Token<T>,
  options: {
    deps?: D
    factory: (...args: { [K in keyof D]: D[K] extends Token<infer U> ? U : never }) => T
  }
): Provider<T> {
  return Object.freeze({
    token: target,
    deps: options.deps ?? [],
    factory: options.factory,
  })
}