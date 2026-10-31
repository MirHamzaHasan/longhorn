#!/usr/bin/env node
import { runCli } from '@longhornjs/cli'

const args = process.argv.slice(2)
process.exitCode = await runCli(args[0] === '--version' ? args : ['create', ...args])
