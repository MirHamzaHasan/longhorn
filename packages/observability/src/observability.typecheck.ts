import { MetricRegistry } from './metrics.js'
import type { SpanContext } from './tracing.js'
const metrics = new MetricRegistry()
const counter = metrics.counter({ name: 'requests', help: 'Requests.', labelNames: ['method', 'route'] })
counter.add(1, { method: 'GET', route: '/items/:id' })
// @ts-expect-error Missing declared labels.
counter.add(1)
// @ts-expect-error Missing route label.
counter.add(1, { method: 'GET' })
// @ts-expect-error Undeclared labels are not part of the contract.
counter.add(1, { method: 'GET', route: '/', requestId: 'unbounded' })
// @ts-expect-error Metric labels are strings.
counter.add(1, { method: 1, route: '/' })
// @ts-expect-error Sampling is a boolean, not a raw flags string.
const invalid: SpanContext = { traceId: 'id', spanId: 'span', sampled: '01' }
void invalid
