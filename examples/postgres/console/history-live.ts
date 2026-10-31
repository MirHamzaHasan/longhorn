import { projectCommandMetadata } from './history-metadata.js'
import type { CommandHistoryItem } from '../src/command-history.js'
export type HistoryPage = Readonly<{ commands: readonly CommandHistoryItem[]; nextCursor: string | null }>
export class HistoryLiveError extends Error {
  constructor() { super('The command list could not be checked. Refresh to try again.'); this.name = 'HistoryLiveError' }
}
/** Project public metadata only. History position is opaque; never infer order from dates or IDs. */
export function readHistoryPage(value: unknown, limit: number, previous: readonly CommandHistoryItem[] = []): HistoryPage {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new HistoryLiveError()
  const data = value as HistoryPage
  if (!Array.isArray(data.commands) || data.commands.length > limit || (data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(data.nextCursor) || data.commands.length !== limit))) throw new HistoryLiveError()
  const seen = new Set(previous.map(row => row.id))
  const commands = data.commands.map(value => {
    const row = projectCommandMetadata(value, () => new HistoryLiveError()) as CommandHistoryItem
    if (seen.has(row.id)) throw new HistoryLiveError()
    seen.add(row.id)
    return Object.freeze({ ...row, delivery: row.delivery ? Object.freeze(row.delivery) : null })
  })
  return Object.freeze({ commands: Object.freeze(commands), nextCursor: data.nextCursor })
}
const canceled = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('List check canceled', 'AbortError') }
/** Refresh the whole loaded window atomically: at most 200 metadata rows in two serial GETs. */
export async function collectHistoryWindow(options: {
  slots: number; signal: AbortSignal;
  read: (input: Readonly<{ limit: number; after: string | null; signal: AbortSignal }>) => Promise<unknown>;
}): Promise<HistoryPage> {
  const { slots, signal, read } = options
  if (!Number.isSafeInteger(slots) || slots < 1 || slots > 10 || typeof read !== 'function') throw new HistoryLiveError()
  const target = slots * 20, commands: CommandHistoryItem[] = [], cursors = new Set<string>(); let after: string | null = null
  do {
    canceled(signal)
    const limit = Math.min(100, target - commands.length)
    const page = readHistoryPage(await read(Object.freeze({ limit, after, signal })), limit, commands)
    canceled(signal)
    commands.push(...page.commands); after = page.nextCursor
    if (after) { if (cursors.has(after)) throw new HistoryLiveError(); cursors.add(after) }
  } while (after && commands.length < target)
  return Object.freeze({ commands: Object.freeze(commands), nextCursor: after })
}
