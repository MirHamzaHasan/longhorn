import { defineConfig } from 'vitest/config'
import base from './vitest.config.js'
export default defineConfig({ ...base, test: { ...base.test, include: ['runtimes/node/src/session-controls.pg.test.ts'], exclude: [], fileParallelism: false } })
