import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import { appBuild,consoleBuild,receiverBuild } from './build.config.mjs'
await rm(new URL('./dist/',import.meta.url), { recursive: true, force: true })
await build(appBuild)
await build(consoleBuild)
await build(receiverBuild)
