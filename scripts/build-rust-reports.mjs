import { runRustCargo } from './rust-reports-tools.mjs'
process.exitCode = await runRustCargo(process.argv[2] ?? 'build')
