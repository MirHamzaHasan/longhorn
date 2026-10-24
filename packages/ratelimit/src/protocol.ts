import type { RateLimitReservation } from './types.js'
export type RateLimitFailure = 'INPUT'|'POLICY_MISMATCH'|'CAPACITY'|'CLOSED'|'PROTOCOL'
export class RateLimitError extends Error {
  constructor(readonly code: RateLimitFailure) {
    super({INPUT:'Invalid request limit input',POLICY_MISMATCH:'Request limit policy differs from the active window',CAPACITY:'Request limit capacity is full',CLOSED:'Request limiter is closed',PROTOCOL:'Invalid request limit store result'}[code])
    this.name='RateLimitError'
  }
}
export function bounded(value:number,maximum:number,minimum=1):number {
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum)throw new RateLimitError('INPUT')
  return value
}
export function clock(now:()=>number):number {return bounded(now(),Number.MAX_SAFE_INTEGER,0)}
export function reservation(input:RateLimitReservation):RateLimitReservation {
  if(!input||typeof input.scope!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input.scope)||typeof input.key!=='string'||!/^[a-f0-9]{64}$/.test(input.key))throw new RateLimitError('INPUT')
  return {scope:input.scope,key:input.key,limit:bounded(input.limit,1_000_000),windowMs:bounded(input.windowMs,86_400_000,1000)}
}
