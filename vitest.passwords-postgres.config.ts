import { defineConfig } from 'vitest/config'
import base from './vitest.config.js'
export default defineConfig({ ...base, test: { ...base.test, include: ['runtimes/node/src/password-changes.pg.test.ts'], exclude: [], fileParallelism: false } })
