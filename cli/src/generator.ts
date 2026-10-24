import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectFiles, runtimes, templates } from './templates.js'
import type { ProjectRuntime, ProjectTemplate } from './templates.js'
import { readD1Template } from './d1-template.js'

type FrameworkPackage = { directory: string; dependencies: Record<string, string> }
type FrameworkManifest = { packages: Record<string, FrameworkPackage> }
export type CreateProjectOptions = {
  directory: string
  runtime: ProjectRuntime
  template?: ProjectTemplate
  name?: string
  /** A built distribution, primarily useful for integration tests and custom distributions. */
  frameworkDirectory?: string
}
export type CreatedProject = { directory: string; name: string; runtime: ProjectRuntime; template: ProjectTemplate; packages: readonly string[] }

async function checkDestination(directory: string): Promise<void> {
  try {
    const info = await lstat(directory)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Destination must be a directory, not a file or symbolic link')
    if ((await readdir(directory)).length) throw new Error('Destination directory must be empty')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function createProject(options: CreateProjectOptions): Promise<CreatedProject> {
  if (!runtimes.includes(options.runtime)) throw new Error(`Unknown runtime: ${options.runtime}`)
  const template = options.template ?? 'api'
  if (!templates.includes(template)) throw new Error(`Unknown template: ${template}`)
  if (template === 'd1-tasks' && options.runtime !== 'workers') throw new Error('The d1-tasks template requires --runtime workers')
  if (!options.directory.trim()) throw new Error('A destination directory is required')
  const directory = resolve(options.directory)
  const name = options.name ?? basename(directory).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name) || name === 'node-modules') {
    throw new Error('Project name must start with a lowercase letter and contain at most 64 lowercase letters, digits, or hyphens')
  }
  await checkDestination(directory)

  const framework = options.frameworkDirectory ?? fileURLToPath(new URL('./framework/', import.meta.url))
  let manifest: FrameworkManifest
  try { manifest = JSON.parse(await readFile(join(framework, 'manifest.json'), 'utf8')) as FrameworkManifest } catch {
    throw new Error('Built framework snapshot is unavailable. Build @longhorn/cli and its dependencies first')
  }
  const selected = new Set<string>()
  function include(name: string): void {
    if (selected.has(name)) return
    const entry = manifest.packages[name]
    if (!entry || !/^[a-z]+$/.test(entry.directory)) throw new Error(`Framework snapshot is missing ${name}`)
    selected.add(name)
    for (const dependency of Object.keys(entry.dependencies)) {
      if (dependency.startsWith('@longhorn/')) include(dependency)
    }
  }
  const d1 = template === 'd1-tasks' ? await readD1Template(framework) : undefined
  const direct = d1 ? Object.keys(d1.dependencies).filter(name => name.startsWith('@longhorn/')) : ['@longhorn/core', '@longhorn/container', '@longhorn/logger', '@longhorn/validation', '@longhorn/events', '@longhorn/cache', '@longhorn/observability', `@longhorn/${options.runtime}`]
  if (!d1) {
    if (options.runtime !== 'workers') direct.push('@longhorn/config')
    else direct.push('@longhorn/runtime')
  }
  for (const name of direct) include(name)
  const packageNames = [...selected].sort()
  const locations = Object.fromEntries(packageNames.map((name) => [name, `file:./.longhorn/framework/${manifest.packages[name]!.directory}`]))
  const dependencies = Object.fromEntries(direct.map((name) => [name, locations[name]!]))
  const files = d1 ? d1.projectFiles(name, dependencies, locations) : projectFiles(name, options.runtime, dependencies, locations)

  await mkdir(dirname(directory), { recursive: true })
  const staging = await mkdtemp(join(dirname(directory), '.longhorn-create-'))
  try {
    for (const [filename, contents] of Object.entries(files)) {
      const target = join(staging, filename)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, contents, { flag: 'wx' })
    }
    for (const name of packageNames) {
      const entry = manifest.packages[name]!
      await cp(join(framework, entry.directory), join(staging, '.longhorn/framework', entry.directory), {
        recursive: true, dereference: false, errorOnExist: true, force: false,
      })
    }
    // A directory rename publishes a complete project. It cannot replace a
    // non-empty destination, even if another process adds files during generation.
    await checkDestination(directory)
    await rename(staging, directory)
  } finally { await rm(staging, { recursive: true, force: true }) }

  return { directory, name, runtime: options.runtime, template, packages: packageNames }
}
