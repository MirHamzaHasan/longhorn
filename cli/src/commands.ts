import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createProject } from './generator.js'
import { runtimes } from './templates.js'
import { signalProcessTree } from './processes.js'
import type { ProjectRuntime } from './templates.js'

const scriptCommands = ['dev', 'build', 'start', 'typecheck', 'test'] as const
type ScriptCommand = typeof scriptCommands[number]
type CliContext = {
  cwd?: string
  out?: (line: string) => void
  error?: (line: string) => void
  execute?: (args: string[], cwd: string) => Promise<number>
}
const help = `LongHorn development CLI

  longhorn create <directory> --runtime node|bun|deno|workers [--name <name>] [--install]
  longhorn dev|build|start|typecheck|test [--cwd <directory>]
  longhorn --help
  longhorn --version

create-longhorn <directory> accepts the same creation options.
Generation uses a bundled framework snapshot; it never overwrites existing files.
pnpm 12.6.0 and Node.js 20.19+ are required for project development.`

function parse(args: string[], values: string[], booleans: string[] = []) {
  const options = new Map<string, string | true>()
  const positional: string[] = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === '--') { positional.push(...args.slice(index + 1)); break }
    if (!argument.startsWith('-')) { positional.push(argument); continue }
    const equals = argument.indexOf('=')
    const key = equals < 0 ? argument : argument.slice(0, equals)
    if (options.has(key)) throw new Error(`Duplicate option: ${key}`)
    if (booleans.includes(key) && equals < 0) { options.set(key, true); continue }
    if (!values.includes(key)) throw new Error(`Unknown option: ${key}`)
    const value = equals < 0 ? args[++index] : argument.slice(equals + 1)
    if (!value || value.startsWith('-')) throw new Error(`Missing value for ${key}`)
    options.set(key, value)
  }
  return { options, positional }
}

async function execute(args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // Script names/arguments are fixed by this CLI, never interpolated from input.
    const child = spawn('pnpm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
    let stopping = false
    let forwarding: Promise<void> = Promise.resolve()
    const forward = (signal: 'SIGINT' | 'SIGTERM') => {
      if (stopping || !child.pid) return
      stopping = true
      forwarding = signalProcessTree(child.pid, signal).catch(() => { child.kill(signal) })
    }
    const interrupt = () => { forward('SIGINT') }
    const terminate = () => { forward('SIGTERM') }
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    function detach() {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
    }
    child.once('error', (error) => { detach(); reject(error) })
    child.once('close', async (code, signal) => {
      detach()
      await forwarding
      resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1))
    })
  })
}

export async function runCli(args: string[], context: CliContext = {}): Promise<number> {
  const out = context.out ?? console.log
  const error = context.error ?? console.error
  const cwd = context.cwd ?? process.cwd()
  const run = context.execute ?? execute
  try {
    if (!args.length || args.includes('--help') || args.includes('-h')) { out(help); return 0 }
    if (args.length === 1 && args[0] === '--version') {
      const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
      out(manifest.version)
      return 0
    }
    const [command, ...rest] = args
    if (command === 'create') {
      const { options, positional } = parse(rest, ['--runtime', '--name'], ['--install'])
      if (positional.length !== 1) throw new Error('Usage: longhorn create <directory> --runtime node|bun|deno|workers')
      const runtime = options.get('--runtime')
      if (!runtimes.includes(runtime as ProjectRuntime)) throw new Error('Select --runtime node, bun, deno, or workers')
      const name = options.get('--name') as string | undefined
      const project = await createProject({
        directory: resolve(cwd, positional[0]!), runtime: runtime as ProjectRuntime,
        ...(name === undefined ? {} : { name }),
      })
      out(`Created ${project.name} for ${project.runtime} at ${project.directory}`)
      if (options.has('--install')) {
        const code = await run(['install'], project.directory)
        if (code !== 0) {
          error(`Project files were created. pnpm install failed (${code}); retry it from ${project.directory}`)
          return code
        }
      }
      out(`Next: open ${project.directory}${options.has('--install') ? '' : ', run pnpm install'}, then pnpm dev`)
      return 0
    }
    if (scriptCommands.includes(command as ScriptCommand)) {
      const { options, positional } = parse(rest, ['--cwd'])
      if (positional.length) throw new Error(`Usage: longhorn ${command} [--cwd <directory>]`)
      const directory = resolve(cwd, options.get('--cwd') as string ?? '.')
      const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as {
        longhorn?: { schemaVersion?: number; runtime?: string }; scripts?: Record<string, string>
      }
      if (manifest.longhorn?.schemaVersion !== 1 || !runtimes.includes(manifest.longhorn.runtime as ProjectRuntime)) {
        throw new Error('This command requires a generated LongHorn project (package.json longhorn.schemaVersion: 1)')
      }
      if (!manifest.scripts?.[command!]) throw new Error(`Project has no ${command} script`)
      return await run(['run', command!], directory)
    }
    throw new Error(`Unknown command: ${command}. Run longhorn --help`)
  } catch (caught) {
    error(caught instanceof Error ? caught.message : String(caught))
    return 1
  }
}
