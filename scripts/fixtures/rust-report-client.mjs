import { createNativeReportComputer } from '../../examples/jobs/dist/native-reports.js'
const [baseUrl, token] = globalThis.Deno?.args ?? globalThis.process.argv.slice(2)
const client = createNativeReportComputer({ baseUrl, token, allowInsecureLoopback: true })
try {
  if (!await client.healthy()) throw new Error('Native report service is unavailable')
  const report = await client.compute({ numbers: [1.5, -2, 4] })
  console.log(JSON.stringify({ verified: true, report }))
} finally { await client.close() }
