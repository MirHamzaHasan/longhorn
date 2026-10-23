declare const TYPE: unique symbol

export type Token<T> = {
  readonly id: symbol
  readonly description: string
  readonly [TYPE]?: T
}

export function token<T>(description: string): Token<T> {
  return Object.freeze({ id: Symbol(description), description })
}