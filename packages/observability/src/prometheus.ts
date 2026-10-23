import type { MetricSnapshot } from './metrics.js'
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'
const help = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
const quote = (value: string) => help(value).replace(/"/g, '\\"')
function labels(values: Readonly<Record<string, string>>): string {
  const entries = Object.entries(values)
  return entries.length ? `{${entries.map(([name, value]) => `${name}="${quote(value)}"`).join(',')}}` : ''
}
/** Render validated registry snapshots in Prometheus's legacy text exposition format. */
export function renderPrometheus(metrics: readonly MetricSnapshot[]): string {
  const lines: string[] = []
  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${help(metric.help)}`, `# TYPE ${metric.name} ${metric.kind}`)
    for (const row of metric.series) {
      if (metric.kind !== 'histogram') lines.push(`${metric.name}${labels(row.labels)} ${row.value}`)
      else {
        metric.boundaries.forEach((boundary, index) => lines.push(`${metric.name}_bucket${labels({ ...row.labels, le: String(boundary) })} ${row.buckets[index]}`))
        lines.push(`${metric.name}_bucket${labels({ ...row.labels, le: '+Inf' })} ${row.count}`,
          `${metric.name}_sum${labels(row.labels)} ${row.sum}`, `${metric.name}_count${labels(row.labels)} ${row.count}`)
      }
    }
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}
