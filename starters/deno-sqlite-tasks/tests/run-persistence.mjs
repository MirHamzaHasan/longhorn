import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { binary, createPermissions } from '../host.mjs'

const directory = fileURLToPath(new URL('..', import.meta.url))
const policy = await createPermissions({ read: true, write: true, env: true, net: ['127.0.0.1'], run: [binary] })
const child = spawn(binary, ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--config=' + policy.filename, '--permission-set=longhorn', 'tests/persistence.mjs'], { cwd: directory, stdio: 'inherit' })
const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM')
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
try { process.exitCode = await new Promise(resolve => { child.once('error', () => {}); child.once('close', code => resolve(code ?? 1)) }) }
finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); await policy.close() }
