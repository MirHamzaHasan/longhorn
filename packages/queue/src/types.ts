export type JobState = 'pending' | 'running' | 'succeeded' | 'failed'
export type JobFailure = 'handler' | 'invalid-payload' | 'lease-expired'

export type JobInfo = {
  readonly id: string
  readonly queue: string
  readonly state: JobState
  readonly attempts: number
  readonly maxAttempts: number
  readonly availableAt: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly leaseUntil: number | null
  readonly lastFailure: JobFailure | null
}
export type StoredJob = JobInfo & { readonly payload: string; readonly leaseToken: string | null }
export type NewJob = {
  readonly id: string; readonly queue: string; readonly payload: string
  readonly maxAttempts: number; readonly availableAt: number; readonly now: number
}
export type Claim = { readonly queue: string; readonly now: number; readonly leaseMs: number; readonly token: string }
export type Ownership = { readonly queue: string; readonly id: string; readonly token: string; readonly now: number }
export type FailJob = Ownership & { readonly retryAt: number | null; readonly reason: JobFailure }

/** All ownership changes must be atomic across every consumer of the same store. */
export interface QueueStore {
  enqueue(job: NewJob): Promise<StoredJob>
  get(queue: string, id: string): Promise<StoredJob | undefined>
  claim(input: Claim): Promise<StoredJob | undefined>
  complete(input: Ownership): Promise<boolean>
  fail(input: FailJob): Promise<boolean>
  renew(input: Ownership & { readonly leaseMs: number }): Promise<boolean>
}
export type JobContext = {
  readonly id: string; readonly queue: string; readonly attempt: number; readonly maxAttempts: number
  /** Cooperative cancellation on lost ownership or a failed heartbeat. */
  readonly signal: AbortSignal
}
export type JobHandler<T> = (data: T, context: JobContext) => void | Promise<void>
export type RunResult = { readonly status: 'idle' } | {
  readonly status: 'succeeded' | 'retrying' | 'failed' | 'lost'; readonly id: string
}

/** Provider metadata only; payloads and lease tokens stay out of status endpoints. */
export function jobInfo(job: StoredJob): JobInfo {
  const { payload: _payload, leaseToken: _token, ...info } = job
  return info
}
