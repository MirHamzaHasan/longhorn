import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = fileURLToPath(new URL('../dist/framework/', import.meta.url))
const directories = [
  'packages/container', 'packages/runtime', 'packages/http', 'packages/logger', 'packages/events', 'packages/cache',
  'packages/validation', 'packages/config', 'packages/database', 'packages/auth', 'packages/core', 'packages/queue', 'packages/scheduler', 'packages/observability', 'packages/idempotency',
  'packages/outbox', 'runtimes/node', 'runtimes/bun', 'runtimes/deno', 'runtimes/workers',
]
const entries = await Promise.all(directories.map(async (directory) => ({
  directory, package: JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8')),
})))
const versions = Object.fromEntries(entries.map((entry) => [entry.package.name, entry.package.version]))
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const packages = {}
for (const entry of entries) {
  const { name, version, type, sideEffects, exports, engines } = entry.package
  const directory = name.slice('@longhorn/'.length)
  const destination = join(output, directory)
  const dependencies = Object.fromEntries(Object.entries(entry.package.dependencies ?? {}).map(([name, spec]) => [
    name, String(spec).startsWith('workspace:') ? versions[name] : spec,
  ]))
  if (Object.values(dependencies).some((value) => value === undefined)) throw new Error(`Missing workspace dependency for ${name}`)
  await mkdir(destination, { recursive: true })
  await cp(join(root, entry.directory, 'dist'), join(destination, 'dist'), { recursive: true })
  await writeFile(join(destination, 'package.json'), `${JSON.stringify({
    name, version, type, sideEffects, exports, engines, files: ['dist'], dependencies,
  }, null, 2)}\n`)
  packages[name] = { directory, dependencies }
}
await writeFile(join(output, 'manifest.json'), `${JSON.stringify({ packages }, null, 2)}\n`)
