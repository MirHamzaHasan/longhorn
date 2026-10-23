import type { Claim, FailJob, NewJob, Ownership, QueueStore, StoredJob } from './types.js'

/** Process-local reference provider. No timers, durability, or cross-process ownership. */
export class MemoryQueueStore implements QueueStore {
  private readonly jobs = new Map<string, StoredJob>()
  private key(queue: string, id: string) { return JSON.stringify([queue, id]) }
  async enqueue(input: NewJob): Promise<StoredJob> {
    const key = this.key(input.queue, input.id)
    if (this.jobs.has(key)) throw new Error('Job already exists')
    const job: StoredJob = { id: input.id, queue: input.queue, payload: input.payload, state: 'pending',
      maxAttempts: input.maxAttempts, attempts: 0, availableAt: input.availableAt,
      createdAt: input.now, updatedAt: input.now, leaseUntil: null, leaseToken: null, lastFailure: null }
    this.jobs.set(key, job)
    return { ...job }
  }
  async get(queue: string, id: string) { const job = this.jobs.get(this.key(queue, id)); return job ? { ...job } : undefined }
  async claim(input: Claim): Promise<StoredJob | undefined> {
    for (const [key, job] of this.jobs) {
      if (job.queue !== input.queue || job.state !== 'running' || job.leaseUntil! > input.now) continue
      this.jobs.set(key, { ...job, state: job.attempts >= job.maxAttempts ? 'failed' : 'pending',
        availableAt: input.now, updatedAt: input.now, leaseToken: null, leaseUntil: null, lastFailure: 'lease-expired' })
    }
    const candidate = [...this.jobs.values()].filter((job) => job.queue === input.queue && job.state === 'pending' && job.availableAt <= input.now)
      .sort((a, b) => a.availableAt - b.availableAt || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
    if (!candidate) return undefined
    const claimed: StoredJob = { ...candidate, state: 'running', attempts: candidate.attempts + 1,
      updatedAt: input.now, leaseToken: input.token, leaseUntil: input.now + input.leaseMs }
    this.jobs.set(this.key(input.queue, claimed.id), claimed)
    return { ...claimed }
  }
  private owned(input: Ownership) {
    const job = this.jobs.get(this.key(input.queue, input.id))
    return job?.state === 'running' && job.leaseToken === input.token && job.leaseUntil! > input.now ? job : undefined
  }
  async complete(input: Ownership) {
    const job = this.owned(input)
    if (!job) return false
    this.jobs.set(this.key(input.queue, input.id), { ...job, state: 'succeeded', updatedAt: input.now, leaseToken: null, leaseUntil: null })
    return true
  }
  async fail(input: FailJob) {
    const job = this.owned(input)
    if (!job) return false
    this.jobs.set(this.key(input.queue, input.id), { ...job,
      state: input.retryAt === null || job.attempts >= job.maxAttempts ? 'failed' : 'pending',
      availableAt: input.retryAt ?? job.availableAt, updatedAt: input.now,
      leaseToken: null, leaseUntil: null, lastFailure: input.reason })
    return true
  }
  async renew(input: Ownership & { leaseMs: number }) {
    const job = this.owned(input)
    if (!job) return false
    this.jobs.set(this.key(input.queue, input.id), { ...job, updatedAt: input.now, leaseUntil: Math.max(job.leaseUntil!, input.now + input.leaseMs) })
    return true
  }
}
