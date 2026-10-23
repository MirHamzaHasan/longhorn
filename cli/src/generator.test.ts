import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProject } from './generator.js'
import { runtimes } from './templates.js'

let temporary: string
let framework: string
beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'longhorn-generator-'))
  framework = join(temporary, 'distribution')
  const packages: Record<string, { directory: string; dependencies: Record<string, string> }> = {}
  for (const name of ['core', 'container', 'http', 'logger', 'runtime', 'config', 'validation', 'database', 'events', 'cache', 'observability', ...runtimes]) {
    const dependencies: Record<string, string> = name === 'core'
      ? { '@longhorn/container': '0.0.1', '@longhorn/http': '0.0.1', '@longhorn/logger': '0.0.1', '@longhorn/runtime': '0.0.1' }
      : name === 'node' ? { '@longhorn/database': '0.0.1', '@longhorn/config': '0.0.1' } : {}
    const directory = join(framework, name)
    await mkdir(join(directory, 'dist'), { recursive: true })
    await writeFile(join(directory, 'dist/index.js'), `export const runtime = ${JSON.stringify(name)}\n`)
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `@longhorn/${name}`, version: '0.0.1', dependencies }))
    packages[`@longhorn/${name}`] = { directory: name, dependencies }
  }
  await writeFile(join(framework, 'manifest.json'), JSON.stringify({ packages }))
})
afterEach(async () => { await rm(temporary, { recursive: true, force: true }) })

describe('project generation', () => {
  it.each(runtimes)('generates an independent %s snapshot and its transitive dependencies', async (runtime) => {
    const directory = join(temporary, 'My Project')
    const project = await createProject({ directory, runtime, frameworkDirectory: framework })
    expect(project.name).toBe('my-project')
    expect(project.packages).toContain('@longhorn/http')
    expect(project.packages).toContain('@longhorn/events')
    expect(project.packages).toContain('@longhorn/cache')
    expect(project.packages).toContain('@longhorn/observability')
    expect(project.packages.includes('@longhorn/database')).toBe(runtime === 'node')
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    expect(manifest.longhorn).toEqual({ schemaVersion: 1, runtime, framework: 'snapshot' })
    expect(manifest.packageManager).toBe('pnpm@12.6.0')
    for (const spec of Object.values(manifest.dependencies)) {
      expect(String(spec)).not.toContain('workspace:')
      expect(String(spec)).not.toContain(temporary)
    }
    const runtimeFile = join(directory, '.longhorn/framework', runtime, 'dist/index.js')
    const previous = await readFile(runtimeFile, 'utf8')
    await writeFile(join(framework, runtime, 'dist/index.js'), 'changed distribution')
    expect(await readFile(runtimeFile, 'utf8')).toBe(previous)
    expect(await readFile(join(directory, 'docs/features.md'), 'utf8')).toContain('dependency-injection.md')
  })

  it('accepts an existing empty directory and an explicit name', async () => {
    const directory = join(temporary, 'empty')
    await mkdir(directory)
    expect((await createProject({ directory, name: 'custom-name', runtime: 'node', frameworkDirectory: framework })).name).toBe('custom-name')
    expect(await readdir(directory)).toContain('package.json')
  })

  it('preserves existing files, including hidden files', async () => {
    const directory = join(temporary, 'occupied')
    await mkdir(directory)
    await writeFile(join(directory, '.keep'), 'precious')
    await expect(createProject({ directory, runtime: 'node', frameworkDirectory: framework })).rejects.toThrow('must be empty')
    expect(await readdir(directory)).toEqual(['.keep'])
    expect(await readFile(join(directory, '.keep'), 'utf8')).toBe('precious')
  })

  it('refuses symbolic-link destinations and plain files', async () => {
    const target = join(temporary, 'target')
    const link = join(temporary, 'link')
    await mkdir(target)
    await symlink(target, link, 'dir')
    await expect(createProject({ directory: link, runtime: 'bun', frameworkDirectory: framework })).rejects.toThrow('symbolic link')
    expect(await readdir(target)).toEqual([])
    const file = join(temporary, 'file')
    await writeFile(file, 'keep')
    await expect(createProject({ directory: file, runtime: 'bun', frameworkDirectory: framework })).rejects.toThrow('not a file')
    expect(await readFile(file, 'utf8')).toBe('keep')
  })

  it('removes staging output after a failed snapshot copy without publishing a partial app', async () => {
    const directory = join(temporary, 'failed')
    await rm(join(framework, 'node'), { recursive: true })
    await expect(createProject({ directory, runtime: 'node', frameworkDirectory: framework })).rejects.toThrow()
    expect(await readdir(temporary)).toEqual(['distribution'])
  })

  it('validates names, destinations, runtime, and distribution before writing', async () => {
    const directory = join(temporary, 'invalid')
    for (const name of ['Invalid Name', '../escape', 'node-modules', 'a'.repeat(65)]) {
      await expect(createProject({ directory, runtime: 'node', name, frameworkDirectory: framework })).rejects.toThrow('Project name')
    }
    await expect(createProject({ directory: ' ', runtime: 'node' })).rejects.toThrow('destination')
    await expect(createProject({ directory, runtime: 'other' as 'node' })).rejects.toThrow('Unknown runtime')
    await expect(createProject({ directory, runtime: 'node', frameworkDirectory: join(temporary, 'absent') })).rejects.toThrow('snapshot is unavailable')
    expect(await readdir(temporary)).toEqual(['distribution'])
  })
})
