import { Tracer } from '../../packages/observability/dist/index.js'
import { OtlpHttpSpanExporter } from '../../packages/observability/dist/otlp.js'
export async function verifyOtlp(endpoint,runtime,authorization) {
  const exporter=new OtlpHttpSpanExporter({ endpoint,serviceName: 'longhorn-otlp-'+runtime,serviceVersion: '1.2.3',
    resourceAttributes: { 'runtime.name': runtime },headers: { authorization },initialRetryDelayMs: 1,maxRetryDelayMs: 4 })
  const tracer=new Tracer({ exporter,now: () => 1792760000000.5 })
  const root=tracer.startSpan('fixture.root',{ attributes: { integer: 42,ratio: 1.5,yes: true,label: 'safe-template' } })
  if (await tracer.trace('fixture.child',() => 42,{ parent: root.context,kind: 'producer' })!==42) throw new Error('Trace changed business result')
  const original=new Error('private business error')
  try { await tracer.trace('fixture.failure',() => { throw original },{ parent: root.context,kind: 'consumer' });throw new Error('Expected original error') }
  catch (error) { if (error!==original) throw error }
  root.setStatus('ok');root.end();await tracer.close()
  const stats=exporter.stats()
  if (stats.acceptedSpans!==3 || stats.failedBatches || !stats.closed) throw new Error('Native export did not drain')
  return { verified: true,runtime,traceId: root.context.traceId,rootId: root.context.spanId,stats }
}
