export type Labels = Readonly<Record<string, string>>
export type LabelValues<L extends readonly string[]> = { readonly [K in L[number]]: string }
type LabelArgs<L extends readonly string[]> = L[number] extends never ? [labels?: LabelValues<L>] : [labels: LabelValues<L>]
export type MetricOptions<L extends readonly string[]> = { readonly name: string; readonly help: string; readonly labelNames?: L }
export type HistogramOptions<L extends readonly string[]> = MetricOptions<L> & { readonly buckets?: readonly number[] }
export interface Counter<L extends readonly string[] = readonly []> { add(value: number, ...labels: LabelArgs<L>): void }
export interface Gauge<L extends readonly string[] = readonly []> { set(value: number, ...labels: LabelArgs<L>): void }
export interface Histogram<L extends readonly string[] = readonly []> { record(value: number, ...labels: LabelArgs<L>): void }
export interface Meter {
  counter<const L extends readonly string[] = readonly []>(options: MetricOptions<L>): Counter<L>
  gauge<const L extends readonly string[] = readonly []>(options: MetricOptions<L>): Gauge<L>
  histogram<const L extends readonly string[] = readonly []>(options: HistogramOptions<L>): Histogram<L>
}
export type MetricSeries = { readonly labels: Labels; readonly value: number; readonly count: number; readonly sum: number; readonly buckets: readonly number[] }
export type MetricSnapshot = {
  readonly name: string; readonly help: string; readonly kind: 'counter' | 'gauge' | 'histogram'
  readonly labelNames: readonly string[]; readonly boundaries: readonly number[]; readonly series: readonly MetricSeries[]
}
type MutableSeries = { labels: Labels; value: number; count: number; sum: number; buckets: number[] }
type Family = Omit<MetricSnapshot, 'series'> & { series: Map<string, MutableSeries> }
export class MetricLimitError extends Error { constructor() { super('Metric capacity exceeded'); this.name = 'MetricLimitError' } }
export class MetricsClosedError extends Error { constructor() { super('Metrics registry is closed'); this.name = 'MetricsClosedError' } }
function limit(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) throw new Error(`Invalid ${name}`)
  return value
}
function finite(value: number) { if (!Number.isFinite(value)) throw new Error('Metric values must be finite') }
export class MetricRegistry implements Meter {
  private readonly families = new Map<string, Family>()
  private readonly reserved = new Set<string>()
  private readonly maxMetrics: number
  private readonly maxSeriesPerMetric: number
  private readonly maxTotalSeries: number
  private totalSeries = 0
  private closed = false
  constructor(options: { maxMetrics?: number; maxSeriesPerMetric?: number; maxTotalSeries?: number } = {}) {
    this.maxMetrics = limit(options.maxMetrics ?? 100, 'maxMetrics')
    this.maxSeriesPerMetric = limit(options.maxSeriesPerMetric ?? 100, 'maxSeriesPerMetric')
    this.maxTotalSeries = limit(options.maxTotalSeries ?? 1000, 'maxTotalSeries')
  }
  private define(options: MetricOptions<readonly string[]>, kind: Family['kind'], boundaries: readonly number[] = []): Family {
    if (this.closed) throw new MetricsClosedError()
    if (typeof options.name !== 'string' || !/^[a-zA-Z_:][a-zA-Z0-9_:]{0,127}$/.test(options.name)) throw new Error('Invalid metric name')
    if (typeof options.help !== 'string' || !options.help || options.help.length > 1024 || /[\x00-\x09\x0b-\x1f\x7f]/.test(options.help)) throw new Error('Invalid metric help')
    if (options.labelNames !== undefined && !Array.isArray(options.labelNames)) throw new Error('Invalid metric labels')
    const names = [...(options.labelNames ?? [])]
    if (names.length > 16 || new Set(names).size !== names.length || names.some((name) => typeof name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name) || name.startsWith('__') || (kind === 'histogram' && name === 'le'))) throw new Error('Invalid metric labels')
    const samples = kind === 'histogram' ? [options.name, `${options.name}_bucket`, `${options.name}_sum`, `${options.name}_count`] : [options.name]
    if (samples.some((name) => this.reserved.has(name))) throw new Error('Metric name or generated sample name already exists')
    if (this.families.size >= this.maxMetrics) throw new MetricLimitError()
    const family: Family = { name: options.name, help: options.help, kind, labelNames: names, boundaries: [...boundaries], series: new Map() }
    for (const sample of samples) this.reserved.add(sample)
    this.families.set(family.name, family)
    return family
  }
  private series(family: Family, labels: Labels = {}): MutableSeries {
    if (this.closed) throw new MetricsClosedError()
    const keys = Object.keys(labels)
    if (keys.length !== family.labelNames.length || keys.some((key) => !family.labelNames.includes(key))) throw new Error('Metric labels must exactly match their declared names')
    const values = family.labelNames.map((name) => {
      const value = labels[name]
      if (typeof value !== 'string' || value.length > 256 || /[\x00-\x09\x0b-\x1f\x7f]/.test(value)) throw new Error('Invalid metric label value')
      return value
    })
    const key = JSON.stringify(values)
    const existing = family.series.get(key)
    if (existing) return existing
    if (family.series.size >= this.maxSeriesPerMetric || this.totalSeries >= this.maxTotalSeries) throw new MetricLimitError()
    const series = { labels: Object.fromEntries(family.labelNames.map((name, index) => [name, values[index]!])), value: 0, count: 0, sum: 0, buckets: family.boundaries.map(() => 0) }
    family.series.set(key, series); this.totalSeries++
    return series
  }
  counter<const L extends readonly string[] = readonly []>(options: MetricOptions<L>): Counter<L> {
    const family = this.define(options, 'counter')
    return { add: (value, ...args) => {
      finite(value); if (value < 0) throw new Error('Counters cannot decrease')
      const row = this.series(family, args[0]); finite(row.value + value); row.value += value
    } }
  }
  gauge<const L extends readonly string[] = readonly []>(options: MetricOptions<L>): Gauge<L> {
    const family = this.define(options, 'gauge')
    return { set: (value, ...args) => { finite(value); this.series(family, args[0]).value = value } }
  }
  histogram<const L extends readonly string[] = readonly []>(options: HistogramOptions<L>): Histogram<L> {
    const boundaries = [...(options.buckets ?? [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10])]
    if (boundaries.length > 64 || boundaries.some((value, index) => !Number.isFinite(value) || value < 0 || (index > 0 && value <= boundaries[index - 1]!))) throw new Error('Histogram buckets must be finite, nonnegative and ascending')
    const family = this.define(options, 'histogram', boundaries)
    return { record: (value, ...args) => {
      finite(value); if (value < 0) throw new Error('Histogram observations must be nonnegative')
      const row = this.series(family, args[0]); finite(row.sum + value)
      if (!Number.isSafeInteger(row.count + 1)) throw new Error('Histogram count exhausted')
      row.count++; row.sum += value
      boundaries.forEach((boundary, index) => { if (value <= boundary) row.buckets[index] = row.buckets[index]! + 1 })
    } }
  }
  snapshot(): readonly MetricSnapshot[] {
    return [...this.families.values()].map((family) => ({ ...family, labelNames: [...family.labelNames], boundaries: [...family.boundaries],
      series: [...family.series.values()].map((row) => ({ ...row, labels: { ...row.labels }, buckets: [...row.buckets] })) }))
  }
  stats() { return { closed: this.closed, metrics: this.families.size, series: this.totalSeries } }
  close(): void { this.closed = true }
}
