import { createNativeReportComputer } from '../../examples/jobs/dist/native-reports.js'
export default { async fetch(_request, env) {
  const client = createNativeReportComputer({ baseUrl: env.SERVICE_URL, token: env.SERVICE_TOKEN, allowInsecureLoopback: true })
  try { return Response.json({ healthy: await client.healthy(), report: await client.compute({ numbers: [1.5, -2, 4] }) }) }
  finally { await client.close() }
} }
