import { verifyOtlp } from './otlp-contract.mjs'
export default { async fetch(request) {
  const { endpoint,authorization }=await request.json()
  try { return Response.json(await verifyOtlp(endpoint,'workers',authorization)) }
  catch { return Response.json({ error: 'Worker OTLP contract failed' },{ status: 500 }) }
} }
