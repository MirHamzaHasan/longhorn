import { Longhorn } from '../../packages/core/dist/index.js'
import { Tracer } from '../../packages/observability/dist/index.js'
import { createScheduledWorker } from '../../runtimes/workers/dist/scheduled.js'
const state={ starts: 0,stops: 0,completed: 0,released: false,events: [],spans: [] }
const app=new Longhorn().onStart(async () => { state.starts++;await Promise.resolve();return () => { state.released=true;state.stops++ } })
app.http.get('/health',c => c.json({ ready: !state.released,name: c.env.NAME }))
const worker=createScheduledWorker(app,{ maxConcurrent: 2,timeoutMs: 1000,handle: async ({ controller,bindings,signal,context }) => {
  if (!context || !bindings.NAME) throw new Error('Invocation context lost')
  const tracer=new Tracer({ exporter: { async export(spans) {
    if (controller.cron==='flush') await fetch(bindings.GATE_URL+'/flush')
    state.spans.push(...spans);if (state.spans.length>32) state.spans.splice(0,state.spans.length-32)
  },close: async () => {} } })
  try {
    await tracer.trace('scheduled.fixture',async () => {
      state.events.push({ cron: controller.cron,time: controller.scheduledTime,name: bindings.NAME })
      if (state.events.length>32) state.events.shift()
      if (controller.cron==='permanent') { controller.noRetry();throw new Error('Fixture permanent failure') }
      if (controller.cron==='failure') throw new Error('Fixture domain failure')
      if (controller.cron.startsWith('hold-') || controller.cron==='ignore-budget' || controller.cron==='cooperative-budget') {
        const response=await fetch(bindings.GATE_URL+'/'+controller.cron,{ ...(controller.cron==='ignore-budget' ? {} : { signal }) })
        await response.text()
      }
      if (state.released) throw new Error('Resources released during managed work')
      state.completed++
    },{ kind: 'consumer',attributes: { 'trigger.kind': 'cron' } })
  } finally { await tracer.close() }
} })
export default { ...worker,async fetch(request,bindings,context) {
  const path=new URL(request.url).pathname
  if (path==='/_fixture/state') return Response.json({ ...state,application: app.state,invocations: worker.stats() })
  if (path==='/_fixture/close') { await Promise.all([worker.close(),app.close()]);return Response.json({ released: state.released,stops: state.stops }) }
  return worker.fetch(request,bindings,context)
} }
