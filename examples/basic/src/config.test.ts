import { expect, it } from 'vitest'
import { loadConfig } from '@longhorn/config'
import { createApp } from './app.js'
import { AppSettings, configSchema } from './config.js'

it('provides sensible default server settings', async () => {
  expect(await loadConfig(configSchema, {})).toEqual({ appName: 'LongHorn', hostname: '127.0.0.1', port: 3000, logLevel: 'info', databasePath: './data/longhorn.sqlite', cacheTtlMs: 5000 })
})

it('parses configured ports and permits explicit ephemeral port zero', async () => {
  expect(await loadConfig(configSchema, { APP_NAME: ' Demo ', HOST: ' localhost ', PORT: ' 4000 ' }))
    .toEqual({ appName: 'Demo', hostname: 'localhost', port: 4000, logLevel: 'info', databasePath: './data/longhorn.sqlite', cacheTtlMs: 5000 })
  expect((await loadConfig(configSchema, { PORT: '0' })).port).toBe(0)
})

it.each(['', ' ', 'abc', '-1', '65536', '1.5', '0x10', '1e3'])('rejects invalid port %j', async (PORT) => {
  await expect(loadConfig(configSchema, { PORT })).rejects.toMatchObject({ message: 'Invalid configuration: PORT' })
})

it('rejects a blank host before starting the server', async () => {
  await expect(loadConfig(configSchema, { HOST: '  ' })).rejects.toMatchObject({ message: 'Invalid configuration: HOST' })
})

it('validates the logging level', async () => {
  expect((await loadConfig(configSchema, { LOG_LEVEL: 'silent' })).logLevel).toBe('silent')
  await expect(loadConfig(configSchema, { LOG_LEVEL: 'verbose' }))
    .rejects.toMatchObject({ message: 'Invalid configuration: LOG_LEVEL' })
})

it('validates the database filename without opening it', async () => {
  expect((await loadConfig(configSchema, { DATABASE_PATH: ':memory:' })).databasePath).toBe(':memory:')
  await expect(loadConfig(configSchema, { DATABASE_PATH: '  ' }))
    .rejects.toMatchObject({ message: 'Invalid configuration: DATABASE_PATH' })
})

it('makes validated settings available to application services and handlers', async () => {
  const config = await loadConfig(configSchema, { APP_NAME: 'Configured app', PORT: '0' })
  const app = createApp(config)
  expect(app.container.resolve(AppSettings)).toBe(config)
  const response = await app.http.request('/')
  expect(await response.json()).toMatchObject({ framework: 'LongHorn', name: 'Configured app' })
})

it('configures bounded summary TTL and permits explicit zero retention', async () => {
  expect((await loadConfig(configSchema, { CACHE_TTL_MS: '0' })).cacheTtlMs).toBe(0)
  for (const CACHE_TTL_MS of ['-1', '1.5', 'Infinity', '3600001']) {
    await expect(loadConfig(configSchema, { CACHE_TTL_MS })).rejects.toMatchObject({ message: 'Invalid configuration: CACHE_TTL_MS' })
  }
})
