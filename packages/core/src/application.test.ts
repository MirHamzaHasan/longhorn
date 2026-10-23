import { test, expect } from 'vitest'
import { Longhorn } from './application.js'

test('1. Register one target', () => {
  const app = new Longhorn()
  app.runtime({ name: 'api', adapter: 'node' })
  const target = app.getRuntime('api')
  expect(target).toEqual({ name: 'api', adapter: 'node' })
})

test('2. Register multiple targets', () => {
  const app = new Longhorn()
  app.runtime({ name: 'api', adapter: 'node' })
  app.runtime({ name: 'realtime', adapter: 'bun' })
  app.runtime({ name: 'edge', adapter: 'workers' })

  expect(app.getRuntimes().length).toBe(3)
})

test('3. Get a target by name', () => {
  const app = new Longhorn()
  app.runtime({ name: 'api', adapter: 'node' })

  const apiTarget = app.getRuntime('api')
  expect(apiTarget?.name).toBe('api')
  expect(apiTarget?.adapter).toBe('node')

  const nonExistent = app.getRuntime('unknown')
  expect(nonExistent).toBeUndefined()
})

test('4. Get all targets', () => {
  const app = new Longhorn()
  app.runtime({ name: 'api', adapter: 'node' })
  app.runtime({ name: 'realtime', adapter: 'bun' })

  const targets = app.getRuntimes()
  expect(targets).toEqual([
    { name: 'api', adapter: 'node' },
    { name: 'realtime', adapter: 'bun' }
  ])
})

test('5. Reject duplicate names', () => {
  const app = new Longhorn()
  app.runtime({ name: 'api', adapter: 'node' })

  expect(() => app.runtime({ name: 'api', adapter: 'bun' })).toThrowError(
    'Runtime target "api" already exists'
  )
})

test('6. Reject empty or whitespace-only name or adapter', () => {
  const app = new Longhorn()

  expect(() => app.runtime({ name: '', adapter: 'node' })).toThrowError(
    'Runtime target name must not be empty'
  )

  expect(() => app.runtime({ name: '   ', adapter: 'node' })).toThrowError(
    'Runtime target name must not be empty'
  )

  expect(() => app.runtime({ name: 'api', adapter: '' })).toThrowError(
    'Runtime target "api" must specify an adapter'
  )

  expect(() => app.runtime({ name: 'api', adapter: '   ' })).toThrowError(
    'Runtime target "api" must specify an adapter'
  )
})

test('7. Returned targets cannot be mutated', () => {
  const app = new Longhorn()
  app.runtime({ name: 'api', adapter: 'node' })

  const target = app.getRuntime('api')!
  expect(Object.isFrozen(target)).toBe(true)

  expect(() => {
    // @ts-expect-error Testing runtime immutability enforcement
    target.adapter = 'bun'
  }).toThrow(TypeError)

  const targets = app.getRuntimes()
  expect(Object.isFrozen(targets[0])).toBe(true)
})
