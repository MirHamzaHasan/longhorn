import type { MetricCollection,MetricSnapshot,MetricSeries } from './metrics.js'
import { otlpNanos } from './otlp-json.js'

const encoder=new TextEncoder()
function finite(value: number): void { if (typeof value!=='number' || !Number.isFinite(value)) throw new Error('Invalid metric value') }
function count(value: number): void { if (!Number.isSafeInteger(value) || value<0) throw new Error('Invalid metric count') }
function family(metric: MetricSnapshot): void {
  if (!metric || typeof metric.name!=='string' || !/^[a-zA-Z_:][a-zA-Z0-9_:]{0,127}$/.test(metric.name) ||
    typeof metric.help!=='string' || !metric.help || metric.help.length>1024 || /[\x00-\x09\x0b-\x1f\x7f]/.test(metric.help) || /[\uD800-\uDFFF]/u.test(metric.help) ||
    !['counter','gauge','histogram'].includes(metric.kind) || !Array.isArray(metric.series)) throw new Error('Invalid metric family')
  if (!Array.isArray(metric.labelNames) || metric.labelNames.length>16 || new Set(metric.labelNames).size!==metric.labelNames.length ||
    [...metric.labelNames].some(name => typeof name!=='string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name) || name.startsWith('__') || (metric.kind==='histogram' && name==='le'))) throw new Error('Invalid metric labels')
  if (!Array.isArray(metric.boundaries) || metric.boundaries.length>64 || (metric.kind!=='histogram' && metric.boundaries.length) ||
    [...metric.boundaries].some((value,index) => !Number.isFinite(value) || value<0 || (index>0 && value<=metric.boundaries[index-1]!))) throw new Error('Invalid metric buckets')
}
function point(metric: MetricSnapshot,row: MetricSeries,startedAt: string,collectedAt: string) {
  if (!row || !row.labels || Object.keys(row.labels).length!==metric.labelNames.length || Object.keys(row.labels).some(key => !metric.labelNames.includes(key))) throw new Error('Invalid metric labels')
  const values=metric.labelNames.map(key => {
    const value=row.labels[key]
    if (typeof value!=='string' || value.length>256 || /[\x00-\x09\x0b-\x1f\x7f]/.test(value) || /[\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid metric label value')
    return value
  })
  const attributes=metric.labelNames.map((key,index) => ({ key,value: { stringValue: values[index]! } }))
  const base={ attributes,timeUnixNano: collectedAt }
  if (metric.kind!=='histogram') {
    finite(row.value)
    if (metric.kind==='counter' && row.value<0) throw new Error('Invalid monotonic counter')
    return { key: JSON.stringify(values),value: { ...base,...(metric.kind==='counter' ? { startTimeUnixNano: startedAt } : {}),asDouble: row.value } }
  }
  count(row.count);finite(row.sum)
  if (row.sum<0 || (row.count===0 && row.sum!==0) || !Array.isArray(row.buckets) || row.buckets.length!==metric.boundaries.length) throw new Error('Invalid histogram')
  let previous=0
  const bucketCounts=Array.from(row.buckets,value => {
    count(value);if (value<previous || value>row.count) throw new Error('Invalid cumulative histogram')
    const result=String(value-previous);previous=value;return result
  })
  bucketCounts.push(String(row.count-previous))
  return { key: JSON.stringify(values),value: { ...base,startTimeUnixNano: startedAt,count: String(row.count),sum: row.sum,explicitBounds: [...metric.boundaries],bucketCounts } }
}

/** Encode cumulative LongHorn series; histogram buckets become OTLP disjoint counts. */
export function otlpMetricsJson(collection: MetricCollection,envelope: { prefix: string;suffix: string },maximumBytes: number,maximumPoints: number): { payload: string;count: number } | undefined {
  if (!collection || !Array.isArray(collection.metrics) || collection.metrics.length>10000 || collection.collectedAt<collection.startedAt) throw new Error('Invalid metric collection')
  const startedAt=otlpNanos(collection.startedAt),collectedAt=otlpNanos(collection.collectedAt)
  let bytes=0,points=0,metrics=0
  const parts: string[]=[],names=new Set<string>()
  const append=(value: string) => { bytes+=encoder.encode(value).byteLength;if (bytes>maximumBytes) throw new RangeError('OTLP metrics request size exceeded');parts.push(value) }
  for (const metric of collection.metrics) {
    family(metric)
    if (names.has(metric.name)) throw new Error('Duplicate metric family')
    names.add(metric.name)
    if (metric.series.length>maximumPoints-points) throw new RangeError('OTLP metric point capacity exceeded')
    if (!metric.series.length) continue
    if (!metrics) append(envelope.prefix)
    else append(',')
    const kind=metric.kind==='counter' ? 'sum' : metric.kind
    append(`{"name":${JSON.stringify(metric.name)},"description":${JSON.stringify(metric.help)},"${kind}":{`)
    if (kind!=='gauge') append(`"aggregationTemporality":2,${kind==='sum' ? '"isMonotonic":true,' : ''}`)
    append('"dataPoints":[')
    const series=new Set<string>()
    for (const [index,row] of metric.series.entries()) {
      const item=point(metric,row,startedAt,collectedAt)
      if (series.has(item.key)) throw new Error('Duplicate metric series')
      series.add(item.key)
      append((index ? ',' : '')+JSON.stringify(item.value));points++
    }
    append(']}}');metrics++
  }
  if (!points) return undefined
  append(envelope.suffix)
  return { payload: parts.join(''),count: points }
}
