import { writeFile } from 'node:fs/promises'
const mode = process.argv[2]
if (process.env.PROCESS_FIXTURE_PID_FILE) await writeFile(process.env.PROCESS_FIXTURE_PID_FILE, String(process.pid))
if (mode === 'exit') { process.stderr.write('private diagnostic credential'); process.exit(9) }
process.on('SIGTERM', () => {
  if (mode === 'ignore') return
  setTimeout(() => process.exit(0), Number(process.env.PROCESS_FIXTURE_DRAIN_MS ?? '0'))
})
setInterval(() => {}, 1000)
if (mode === 'stdout') process.stdout.write('x'.repeat(10000))
else if (mode === 'stderr') process.stderr.write('private diagnostic credential'.repeat(1000))
else if (mode === 'utf8') process.stdout.write(Buffer.from([0xff, 10]))
else if (mode === 'split') {
  const line = Buffer.from(JSON.stringify({ ready: true, value: 'café' }) + '\n'), at = line.indexOf(Buffer.from('é')) + 1
  process.stdout.write(line.subarray(0, at)); setTimeout(() => process.stdout.write(line.subarray(at)), 20)
}
else if (mode !== 'wait') process.stdout.write(JSON.stringify({ ready: true, value: process.env.PROCESS_FIXTURE_VALUE ?? 'absent', inherited: process.env.PROCESS_FIXTURE_PARENT ?? 'absent', args: process.argv.slice(3) }) + '\n')
if (mode === 'runtime-output') setTimeout(() => process.stderr.write('x'.repeat(10000)), 30)
