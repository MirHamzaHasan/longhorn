import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli } from './commands.js'

let directory: string
let output: string[]
let errors: string[]
const context = () => ({ cwd: directory, out: (line: string) => output.push(line), error: (line: string) => errors.push(line) })
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'longhorn-commands-'))
  output = []; errors = []
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

it('prints help and version without changing the working directory', async () => {
  expect(await runCli([], context())).toBe(0)
  expect(output.join('\n')).toContain('--runtime node|bun|deno|workers')
  expect(await runCli(['--version'], context())).toBe(0)
  expect(output.at(-1)).toMatch(/^\d+\.\d+\.\d+$/)
  expect(errors).toEqual([])
})

it.each([
  ['create'], ['create', 'app'], ['create', 'app', '--runtime', 'rust'],
  ['create', 'app', '--runtime'], ['create', 'app', '--runtime', 'node', '--runtime', 'bun'],
  ['create', 'app', '--runtime', 'node', '--force'], ['create', 'a', 'b', '--runtime', 'node'],
  ['create','app','--runtime','workers','--template'], ['create','app','--runtime','workers','--template','unknown'],
  ['create','app','--runtime','node','--template','d1-tasks'], ['create','app','--runtime','workers','--template','api','--template','d1-tasks'],
  ['build', '--cwd'], ['build', '--cwd', '.', '--unsafe'], ['build', 'extra'], ['publish'],
])('rejects invalid arguments %j without executing a process', async (...args) => {
  let executed = false
  const result = await runCli(args, { ...context(), execute: async () => { executed = true; return 0 } })
  expect(result).toBe(1)
  expect(errors.length).toBe(1)
  expect(executed).toBe(false)
})

it('delegates a fixed script in the chosen project and preserves its exit code', async () => {
  const project = join(directory, 'app with spaces')
  await mkdir(project)
  await writeFile(join(project, 'package.json'), JSON.stringify({
    longhorn: { schemaVersion: 1, runtime: 'deno' }, scripts: { build: 'node build.mjs' },
  }))
  const calls: unknown[] = []
  expect(await runCli(['build', '--cwd=app with spaces'], {
    ...context(), execute: async (...args) => { calls.push(args); return 7 },
  })).toBe(7)
  expect(calls).toEqual([[['run', 'build'], project]])
})

it('refuses unrelated directories and missing scripts', async () => {
  await writeFile(join(directory, 'package.json'), JSON.stringify({ scripts: { build: 'something' } }))
  expect(await runCli(['build'], context())).toBe(1)
  expect(errors.at(-1)).toContain('generated LongHorn project')
  await writeFile(join(directory, 'package.json'), JSON.stringify({ longhorn: { schemaVersion: 1, runtime: 'node' } }))
  expect(await runCli(['start'], context())).toBe(1)
  expect(errors.at(-1)).toContain('no start script')
})
