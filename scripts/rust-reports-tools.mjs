import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const rustReportBinary = fileURLToPath(new URL('../native/rust/target/debug/longhorn-native-reports' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url))
export async function runRustCargo(action) {
  if (!['build', 'test', 'fmt'].includes(action)) throw new Error('Unsupported native build action')
  const env = { ...process.env }
  if (process.platform === 'darwin') {
    // Child-only SDK/linker selection; never change the machine's selected Xcode or license state.
    const sdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', compiler = '/Library/Developer/CommandLineTools/usr/bin/clang'
    try {
      await Promise.all([access(sdk), access(compiler)])
      env.SDKROOT ??= sdk
      env['CARGO_TARGET_' + (process.arch === 'arm64' ? 'AARCH64' : 'X86_64') + '_APPLE_DARWIN_LINKER'] ??= compiler
    } catch { /* Use the caller's normal compiler selection when Command Line Tools are absent. */ }
  }
  const args = ['+1.97.1', action, '--manifest-path', fileURLToPath(new URL('../native/rust/Cargo.toml', import.meta.url)), ...(action === 'fmt' ? ['--', '--check'] : ['--locked'])]
  const child = spawn('cargo', args, { env, stdio: 'inherit' })
  const forward = signal => child.kill(signal)
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM')
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
  try { return await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1))) }) }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate) }
}
