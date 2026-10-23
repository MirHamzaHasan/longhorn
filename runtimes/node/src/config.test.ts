import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { readEnv } from './config.js'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'longhorn-config-'))
  directories.push(directory)
  return directory
}

it('merges files in order with environment variables taking precedence', async () => {
  const directory = await fixture()
  const first = join(directory, '.env')
  const second = join(directory, '.env.local')
  await writeFile(first, 'PORT=3000\nNAME=base\nREGION=local\n')
  await writeFile(second, 'PORT=4000\nNAME=override\n')
  const environment = await readEnv({ files: [first, second], env: { PORT: '5000' } })
  expect(environment).toEqual({ PORT: '5000', NAME: 'override', REGION: 'local' })
  expect(Object.isFrozen(environment)).toBe(true)
})

it('supports file URLs, quotes, comments, and multiline values using the Node parser', async () => {
  const directory = await fixture()
  const file = join(directory, '.env')
  await writeFile(file, '# Comment\nexport NAME="LongHorn App"\nTEXT="line one\nline two"\nEMPTY=\n')
  expect(await readEnv({ files: [pathToFileURL(file)], env: {} })).toEqual({
    NAME: 'LongHorn App', TEXT: 'line one\nline two', EMPTY: '',
  })
})

it('does not write file values into process.env', async () => {
  const directory = await fixture()
  const file = join(directory, '.env')
  vi.stubEnv('LONGHORN_CONFIG_FILE_TEST', undefined)
  await writeFile(file, 'LONGHORN_CONFIG_FILE_TEST=file-value\n')
  const environment = await readEnv({ files: [file], env: {} })
  expect(environment.LONGHORN_CONFIG_FILE_TEST).toBe('file-value')
  expect(process.env.LONGHORN_CONFIG_FILE_TEST).toBeUndefined()
})

it('reads a snapshot of process variables by default', async () => {
  vi.stubEnv('LONGHORN_CONFIG_SNAPSHOT_TEST', 'first')
  const environment = await readEnv()
  vi.stubEnv('LONGHORN_CONFIG_SNAPSHOT_TEST', 'second')
  expect(environment.LONGHORN_CONFIG_SNAPSHOT_TEST).toBe('first')
})

it('ignores undefined environment values and keeps explicitly empty strings', async () => {
  const directory = await fixture()
  const file = join(directory, '.env')
  await writeFile(file, 'NAME=file\nREGION=local\n')
  expect(await readEnv({ files: [file], env: { NAME: '', REGION: undefined } }))
    .toEqual({ NAME: '', REGION: 'local' })
})

it('can explicitly ignore missing files', async () => {
  const directory = await fixture()
  const missing = join(directory, 'missing.env')
  await expect(readEnv({ files: [missing], env: {} })).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readEnv({ files: [missing], env: { PORT: '3000' }, ignoreMissing: true }))
    .toEqual({ PORT: '3000' })
})

it('propagates other file errors even when missing files are optional', async () => {
  const directory = await fixture()
  await expect(readEnv({ files: [directory], env: {}, ignoreMissing: true }))
    .rejects.toMatchObject({ code: 'EISDIR' })
})

it('captures the supplied environment before awaiting file reads', async () => {
  const directory = await fixture()
  const file = join(directory, '.env')
  await writeFile(file, 'PORT=1000\n')
  const source = { PORT: '3000' }
  const promise = readEnv({ files: [file], env: source })
  source.PORT = '4000'
  expect((await promise).PORT).toBe('3000')
})
