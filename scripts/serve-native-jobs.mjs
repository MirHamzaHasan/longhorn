import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runRustCargo, rustReportBinary } from './rust-reports-tools.mjs'

const configured = process.env.REPORTS_NATIVE_BINARY
const code = configured ? 0 : await runRustCargo('build')
if (code) process.exitCode = code
else {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../examples/jobs/dist/native-index.js', import.meta.url))], {
    env: { ...process.env, REPORTS_NATIVE_BINARY: configured ?? rustReportBinary }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })
  const notify = (action, pid) => { if (process.connected && pid) process.send?.({ action, pid }, () => {}) }
  notify('opened', child.pid)
  child.on('message', message => { if (Number.isSafeInteger(message?.pid) && ['opened', 'closed'].includes(message.action)) notify(message.action, message.pid) })
  const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM')
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
  try { process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { notify('closed', child.pid); resolve(code ?? (signal === 'SIGINT' ? 130 : 1)) }) }) }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate) }
}
