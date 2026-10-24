import { build } from 'esbuild'
import { readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))
await rm(new URL('./.test-dist', import.meta.url), { recursive: true, force: true })
const entryPoints = (await readdir(new URL('./src', import.meta.url))).filter(name => name.endsWith('.test.ts')).map(name => 'src/' + name)
await build({ absWorkingDir: directory, entryPoints, outdir: '.test-dist', bundle: true, format: 'esm', platform: 'node', packages: 'external', target: 'es2022', sourcemap: true })
