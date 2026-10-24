import { spawn } from 'node:child_process'
import { runRustCargo, rustReportBinary } from './rust-reports-tools.mjs'
const code = await runRustCargo('build')
if (code) process.exitCode = code
else {
  const child = spawn(rustReportBinary, [], { stdio: 'inherit', env: process.env })
  const notify = action => { if (process.connected && child.pid) process.send?.({ action, pid: child.pid }, () => {}) }
  notify('opened'); child.once('close', () => notify('closed'))
  const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM')
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
  try { process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1))) }) }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate) }
}
